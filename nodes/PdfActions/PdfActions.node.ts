import { imageSize } from 'image-size';
import type {
	IBinaryData,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import PDFDocument from 'pdfkit';

interface BinaryInput {
	buffer: Buffer;
	key: string;
}

type PdfAction = 'imagesToPdfs' | 'imagesToOnePdf' | 'pdfsToOnePdf';

function isImage(binary: IBinaryData): boolean {
	return binary.mimeType?.startsWith('image/') === true || binary.fileType === 'image';
}

function isPdf(binary: IBinaryData): boolean {
	return (
		binary.mimeType === 'application/pdf' ||
		binary.fileExtension?.toLowerCase() === 'pdf' ||
		binary.fileName?.toLowerCase().endsWith('.pdf') === true
	);
}

export function normalizePdfName(name: string): string {
	const trimmedName = name.trim() || 'images';
	return trimmedName.toLowerCase().endsWith('.pdf') ? trimmedName : `${trimmedName}.pdf`;
}

export async function createPdf(images: BinaryInput[]): Promise<Buffer> {
	if (images.length === 0) {
		throw new ApplicationError('No image binary data was found');
	}

	const document = new PDFDocument({
		autoFirstPage: false,
		margin: 0,
	});
	const chunks: Buffer[] = [];
	document.on('data', (chunk: Buffer) => chunks.push(chunk));

	const completedPdf = new Promise<Buffer>((resolve, reject) => {
		document.on('end', () => resolve(Buffer.concat(chunks)));
		document.on('error', reject);
	});

	for (const image of images) {
		const dimensions = imageSize(image.buffer);
		if (!dimensions.width || !dimensions.height) {
			throw new ApplicationError(
				`Unable to determine image dimensions for binary property "${image.key}"`,
			);
		}

		const pageSize: [number, number] = [dimensions.width, dimensions.height];
		document.addPage({ margin: 0, size: pageSize });
		document.image(image.buffer, 0, 0, {
			align: 'center',
			fit: pageSize,
			valign: 'center',
		});
	}

	document.end();
	return await completedPdf;
}

export async function mergePdfs(pdfs: BinaryInput[]): Promise<Buffer> {
	if (pdfs.length === 0) {
		throw new ApplicationError('No PDF binary data was found');
	}

	const mergedPdf = await PDFLibDocument.create();

	for (const pdf of pdfs) {
		const sourcePdf = await PDFLibDocument.load(pdf.buffer);
		const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
		for (const page of pages) mergedPdf.addPage(page);
	}

	return Buffer.from(await mergedPdf.save());
}

export class PdfActions implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDF Actions',
		name: 'pdfActions',
		icon: { light: 'file:pdf-actions.svg', dark: 'file:pdf-actions.dark.svg' },
		group: ['transform'],
		version: [1, 2],
		description: 'Convert images to PDFs or merge existing PDF documents',
		subtitle:
			'={{$parameter["action"] === "imagesToPdfs" ? "Images to PDFs" : $parameter["action"] === "pdfsToOnePdf" ? "Merge PDFs" : "Images to one PDF"}}',
		defaults: {
			name: 'PDF Actions',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Action',
				name: 'action',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Multiple Images to Multiple PDFs',
						value: 'imagesToPdfs',
						description: 'Create one PDF for every incoming item containing images',
						action: 'Convert images to separate PDF documents',
					},
					{
						name: 'Multiple Images to One PDF',
						value: 'imagesToOnePdf',
						description: 'Merge all incoming images into a single PDF',
						action: 'Convert multiple images to one PDF',
					},
					{
						name: 'Multiple PDFs to One PDF',
						value: 'pdfsToOnePdf',
						description: 'Merge all pages from incoming PDF files into a single PDF',
						action: 'Merge PDF documents into one file',
					},
				],
				default: 'imagesToOnePdf',
			},
			{
				displayName: 'Output Binary Field',
				name: 'outputKey',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property that will contain the generated PDF',
			},
			{
				displayName: 'PDF File Name',
				name: 'pdfName',
				type: 'string',
				default: 'images.pdf',
				required: true,
				description: 'Name of the generated PDF file',
			},
			{
				displayName: 'Keep Source Files',
				name: 'keepSources',
				type: 'boolean',
				default: false,
				description: 'Whether to keep source images or PDFs alongside the generated PDF',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const nodeParameters = this.getNode().parameters;
		let action = nodeParameters.action as PdfAction | undefined;

		if (!action) {
			const legacyMergeAll = nodeParameters.mergeAll as boolean | undefined;
			action = legacyMergeAll === false ? 'imagesToPdfs' : 'imagesToOnePdf';
		}

		try {
			if (action === 'imagesToPdfs') {
				return await executeImagesPerItem.call(this, inputItems);
			}

			return await executeMerged.call(this, inputItems, action);
		} catch (error) {
			if (this.continueOnFail()) {
				return [
					[
						{
							json: {},
							error,
							pairedItem: inputItems.map((_, item) => ({ item })),
						},
					],
				];
			}

			throw new NodeOperationError(this.getNode(), error);
		}
	}
}

async function executeMerged(
	this: IExecuteFunctions,
	inputItems: INodeExecutionData[],
	action: Exclude<PdfAction, 'imagesToPdfs'>,
): Promise<INodeExecutionData[][]> {
	const sources: BinaryInput[] = [];
	const outputBinary: Record<string, IBinaryData> = {};
	const keepSources = getKeepSources.call(this, 0);

	for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
		for (const [key, binary] of Object.entries(inputItems[itemIndex].binary ?? {})) {
			const matchesAction = action === 'imagesToOnePdf' ? isImage(binary) : isPdf(binary);
			if (!matchesAction) continue;

			sources.push({
				buffer: await this.helpers.getBinaryDataBuffer(itemIndex, key),
				key,
			});

			if (keepSources) {
				outputBinary[`item_${itemIndex}_${key}`] = { ...binary };
			}
		}
	}

	try {
		const pdf = action === 'imagesToOnePdf' ? await createPdf(sources) : await mergePdfs(sources);
		const outputKey = this.getNodeParameter('outputKey', 0, 'data') as string;
		const pdfName = normalizePdfName(
			this.getNodeParameter(
				'pdfName',
				0,
				action === 'imagesToOnePdf' ? 'images.pdf' : 'merged.pdf',
			) as string,
		);
		outputBinary[outputKey] = await this.helpers.prepareBinaryData(
			pdf,
			pdfName,
			'application/pdf',
		);

		return [
			[
				{
					json: {},
					binary: outputBinary,
					pairedItem: inputItems.map((_, item) => ({ item })),
				},
			],
		];
	} catch (error) {
		throw new NodeOperationError(this.getNode(), error);
	}
}

async function executeImagesPerItem(
	this: IExecuteFunctions,
	inputItems: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
	const outputItems: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
		try {
			const sourceItem = inputItems[itemIndex];
			const images: BinaryInput[] = [];
			const outputBinary: Record<string, IBinaryData> = {};
			const keepSources = getKeepSources.call(this, itemIndex);

			for (const [key, binary] of Object.entries(sourceItem.binary ?? {})) {
				if (isImage(binary)) {
					images.push({
						buffer: await this.helpers.getBinaryDataBuffer(itemIndex, key),
						key,
					});
					if (keepSources) outputBinary[key] = { ...binary };
				} else {
					outputBinary[key] = { ...binary };
				}
			}

			const pdf = await createPdf(images);
			const outputKey = this.getNodeParameter('outputKey', itemIndex, 'data') as string;
			const pdfName = normalizePdfName(
				this.getNodeParameter('pdfName', itemIndex, 'images.pdf') as string,
			);
			outputBinary[outputKey] = await this.helpers.prepareBinaryData(
				pdf,
				pdfName,
				'application/pdf',
			);

			outputItems.push({
				json: { ...sourceItem.json },
				binary: outputBinary,
				pairedItem: { item: itemIndex },
			});
		} catch (error) {
			if (!this.continueOnFail()) {
				throw new NodeOperationError(this.getNode(), error, { itemIndex });
			}

			outputItems.push({
				json: { ...inputItems[itemIndex].json },
				error,
				pairedItem: { item: itemIndex },
			});
		}
	}

	return [outputItems];
}

function getKeepSources(this: IExecuteFunctions, itemIndex: number): boolean {
	const parameters = this.getNode().parameters;
	if (parameters.keepSources === undefined && parameters.keepImages !== undefined) {
		return this.getNodeParameter('keepImages', itemIndex, false) as boolean;
	}

	return this.getNodeParameter('keepSources', itemIndex, false) as boolean;
}
