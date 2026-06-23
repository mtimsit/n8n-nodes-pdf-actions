import { createCanvas, loadImage } from '@napi-rs/canvas';
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
import { pdfToPng } from 'pdf-to-png-converter';
import PDFDocument from 'pdfkit';

interface BinaryInput {
	buffer: Buffer;
	key: string;
}

type PdfAction =
	| 'imagesToPdfs'
	| 'imagesToOnePdf'
	| 'pdfsToOnePdf'
	| 'pdfToPdfs'
	| 'pdfToImages';

type ImageFormat = 'jpeg' | 'png';

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

export async function splitPdf(pdf: Buffer): Promise<Buffer[]> {
	const sourcePdf = await PDFLibDocument.load(pdf);
	const outputPdfs: Buffer[] = [];

	for (const pageIndex of sourcePdf.getPageIndices()) {
		const pagePdf = await PDFLibDocument.create();
		const [page] = await pagePdf.copyPages(sourcePdf, [pageIndex]);
		pagePdf.addPage(page);
		outputPdfs.push(Buffer.from(await pagePdf.save()));
	}

	return outputPdfs;
}

export async function renderPdfPages(
	pdf: Buffer,
	format: ImageFormat,
	scale: number,
	jpegQuality: number,
): Promise<Buffer[]> {
	const pages = await pdfToPng(pdf, {
		processPagesInParallel: false,
		returnPageContent: true,
		viewportScale: scale,
	});

	if (format === 'png') {
		return pages.map((page) => {
			if (!page.content) throw new ApplicationError(`Unable to render PDF page ${page.pageNumber}`);
			return page.content;
		});
	}

	const outputImages: Buffer[] = [];
	for (const page of pages) {
		if (!page.content) throw new ApplicationError(`Unable to render PDF page ${page.pageNumber}`);
		const image = await loadImage(page.content);
		const canvas = createCanvas(page.width, page.height);
		const context = canvas.getContext('2d');
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, page.width, page.height);
		context.drawImage(image, 0, 0);
		outputImages.push(canvas.toBuffer('image/jpeg', jpegQuality));
	}

	return outputImages;
}

export function createNumberedFileName(name: string, index: number, extension: string): string {
	const trimmedName = name.trim() || 'output';
	const baseName = trimmedName.replace(/\.(?:jpe?g|pdf|png)$/i, '');
	return `${baseName}_${index}.${extension}`;
}

export class PdfActions implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'pdfActions',
		name: 'pdfActions',
		icon: { light: 'file:pdf-actions.svg', dark: 'file:pdf-actions.dark.svg' },
		group: ['transform'],
		version: [1, 2, 3],
		description: 'Convert, merge, split, and render PDF documents',
		subtitle:
			'={{$parameter["action"] === "imagesToPdfs" ? "Images to PDFs" : $parameter["action"] === "pdfsToOnePdf" ? "Merge PDFs" : $parameter["action"] === "pdfToPdfs" ? "Split PDF" : $parameter["action"] === "pdfToImages" ? "PDF to images" : "Images to one PDF"}}',
		defaults: {
			name: 'pdfActions',
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
					{
						name: 'One PDF to Multiple Images',
						value: 'pdfToImages',
						description: 'Render every PDF page as a separate PNG or JPEG image',
						action: 'Convert a PDF into separate images',
					},
					{
						name: 'One PDF to Multiple PDFs',
						value: 'pdfToPdfs',
						description: 'Create one single-page PDF for every page in each incoming PDF',
						action: 'Split a PDF into separate PDF documents',
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
				description: 'Name of the binary property that will contain each generated file',
			},
			{
				displayName: 'Output File Name',
				name: 'pdfName',
				type: 'string',
				default: 'images.pdf',
				required: true,
				description:
					'Name of the generated file, used as the base name with _0, _1, and so on for multiple outputs',
			},
			{
				displayName: 'Image Format',
				name: 'imageFormat',
				type: 'options',
				options: [
					{
						name: 'JPEG',
						value: 'jpeg',
					},
					{
						name: 'PNG',
						value: 'png',
					},
				],
				default: 'png',
				displayOptions: {
					show: {
						action: ['pdfToImages'],
					},
				},
			},
			{
				displayName: 'Render Scale',
				name: 'renderScale',
				type: 'number',
				typeOptions: {
					minValue: 0.5,
					maxValue: 5,
					numberPrecision: 1,
				},
				default: 2,
				description: 'Page rendering scale; higher values produce larger, sharper images',
				displayOptions: {
					show: {
						action: ['pdfToImages'],
					},
				},
			},
			{
				displayName: 'JPEG Quality',
				name: 'jpegQuality',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 90,
				description: 'JPEG compression quality from 1 to 100',
				displayOptions: {
					show: {
						action: ['pdfToImages'],
						imageFormat: ['jpeg'],
					},
				},
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

			if (action === 'pdfToPdfs' || action === 'pdfToImages') {
				return await executePdfToMultiple.call(this, inputItems, action);
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
	action: 'imagesToOnePdf' | 'pdfsToOnePdf',
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

async function executePdfToMultiple(
	this: IExecuteFunctions,
	inputItems: INodeExecutionData[],
	action: 'pdfToPdfs' | 'pdfToImages',
): Promise<INodeExecutionData[][]> {
	const outputItems: INodeExecutionData[] = [];
	const outputKey = this.getNodeParameter('outputKey', 0, 'data') as string;
	const outputName = this.getNodeParameter('pdfName', 0, 'output') as string;
	const keepSources = getKeepSources.call(this, 0);
	const imageFormat = this.getNodeParameter('imageFormat', 0, 'png') as ImageFormat;
	const renderScale = this.getNodeParameter('renderScale', 0, 2) as number;
	const jpegQuality = (this.getNodeParameter('jpegQuality', 0, 90) as number) / 100;
	let outputIndex = 0;

	for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
		const sourceItem = inputItems[itemIndex];

		for (const [key, binary] of Object.entries(sourceItem.binary ?? {})) {
			if (!isPdf(binary)) continue;

			const sourcePdf = await this.helpers.getBinaryDataBuffer(itemIndex, key);
			const outputBuffers =
				action === 'pdfToPdfs'
					? await splitPdf(sourcePdf)
					: await renderPdfPages(sourcePdf, imageFormat, renderScale, jpegQuality);
			const extension = action === 'pdfToPdfs' ? 'pdf' : imageFormat === 'jpeg' ? 'jpg' : 'png';
			const mimeType =
				action === 'pdfToPdfs'
					? 'application/pdf'
					: imageFormat === 'jpeg'
						? 'image/jpeg'
						: 'image/png';

			for (let pageIndex = 0; pageIndex < outputBuffers.length; pageIndex++) {
				const outputBinary: Record<string, IBinaryData> = {};
				if (keepSources) outputBinary[key] = { ...binary };

				const fileName = createNumberedFileName(outputName, outputIndex, extension);
				outputBinary[outputKey] = await this.helpers.prepareBinaryData(
					outputBuffers[pageIndex],
					fileName,
					mimeType,
				);
				outputItems.push({
					json: {
						...sourceItem.json,
						outputIndex,
						pageNumber: pageIndex + 1,
					},
					binary: outputBinary,
					pairedItem: { item: itemIndex },
				});
				outputIndex++;
			}
		}
	}

	if (outputItems.length === 0) {
		throw new ApplicationError('No PDF binary data was found');
	}

	return [outputItems];
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
			const pdfName = createNumberedFileName(
				this.getNodeParameter('pdfName', itemIndex, 'images.pdf') as string,
				itemIndex,
				'pdf',
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
