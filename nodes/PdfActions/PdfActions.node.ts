import { imageSize } from 'image-size';
import type {
	IBinaryData,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import PDFDocument from 'pdfkit';

interface ImageInput {
	buffer: Buffer;
	key: string;
}

function isImage(binary: IBinaryData): boolean {
	return binary.mimeType?.startsWith('image/') === true || binary.fileType === 'image';
}

export function normalizePdfName(name: string): string {
	const trimmedName = name.trim() || 'images';
	return trimmedName.toLowerCase().endsWith('.pdf') ? trimmedName : `${trimmedName}.pdf`;
}

export async function createPdf(images: ImageInput[]): Promise<Buffer> {
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

export class PdfActions implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDF Actions',
		name: 'pdfActions',
		icon: { light: 'file:pdf-actions.svg', dark: 'file:pdf-actions.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Convert incoming images to PDF documents',
		subtitle: '={{$parameter["mergeAll"] ? "Merge all images" : "One PDF per item"}}',
		defaults: {
			name: 'PDF Actions',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Merge Into One PDF',
				name: 'mergeAll',
				type: 'boolean',
				default: false,
				description:
					'Whether to merge images from every input item into one PDF instead of creating one PDF per item',
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
				displayName: 'Keep Source Images',
				name: 'keepImages',
				type: 'boolean',
				default: false,
				description: 'Whether to keep the source image binaries in the output',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const mergeAll = this.getNodeParameter('mergeAll', 0, false) as boolean;

		try {
			if (mergeAll) {
				return await executeMerged.call(this, inputItems);
			}

			return await executePerItem.call(this, inputItems);
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
): Promise<INodeExecutionData[][]> {
	const images: ImageInput[] = [];
	const outputBinary: Record<string, IBinaryData> = {};
	const keepImages = this.getNodeParameter('keepImages', 0, false) as boolean;

	for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
		for (const [key, binary] of Object.entries(inputItems[itemIndex].binary ?? {})) {
			if (!isImage(binary)) continue;

			images.push({
				buffer: await this.helpers.getBinaryDataBuffer(itemIndex, key),
				key,
			});

			if (keepImages) {
				outputBinary[`item_${itemIndex}_${key}`] = { ...binary };
			}
		}
	}

	try {
		const pdf = await createPdf(images);
		const outputKey = this.getNodeParameter('outputKey', 0, 'data') as string;
		const pdfName = normalizePdfName(
			this.getNodeParameter('pdfName', 0, 'images.pdf') as string,
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

async function executePerItem(
	this: IExecuteFunctions,
	inputItems: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
	const outputItems: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
		try {
			const sourceItem = inputItems[itemIndex];
			const images: ImageInput[] = [];
			const outputBinary: Record<string, IBinaryData> = {};
			const keepImages = this.getNodeParameter('keepImages', itemIndex, false) as boolean;

			for (const [key, binary] of Object.entries(sourceItem.binary ?? {})) {
				if (isImage(binary)) {
					images.push({
						buffer: await this.helpers.getBinaryDataBuffer(itemIndex, key),
						key,
					});
					if (keepImages) outputBinary[key] = { ...binary };
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
