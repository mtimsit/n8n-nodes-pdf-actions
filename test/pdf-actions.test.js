const assert = require('node:assert/strict');
const test = require('node:test');
const { PDFDocument } = require('pdf-lib');

const {
	createPdf,
	createNumberedFileName,
	mergePdfs,
	normalizePdfName,
	PdfActions,
	renderPdfPages,
	splitPdf,
} = require('../dist/nodes/PdfActions/PdfActions.node.js');

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
);

async function createSourcePdf(pageCount) {
	const document = await PDFDocument.create();
	for (let index = 0; index < pageCount; index++) document.addPage([100, 100]);
	return Buffer.from(await document.save());
}

async function getPageCount(pdf) {
	return (await PDFDocument.load(pdf)).getPageCount();
}

test('normalizes PDF filenames', () => {
	assert.equal(normalizePdfName('report'), 'report.pdf');
	assert.equal(normalizePdfName('report.PDF'), 'report.PDF');
	assert.equal(normalizePdfName('  '), 'images.pdf');
});

test('exposes a searchable pdfActions node name', () => {
	const description = new PdfActions().description;
	assert.equal(description.displayName, 'pdfActions');
	assert.equal(description.name, 'pdfActions');
});

test('creates zero-based numbered output filenames', () => {
	assert.equal(createNumberedFileName('document.pdf', 0, 'pdf'), 'document_0.pdf');
	assert.equal(createNumberedFileName('scan.png', 7, 'jpg'), 'scan_7.jpg');
	assert.equal(createNumberedFileName('', 2, 'png'), 'output_2.png');
});

test('creates one PDF page for every supplied image', async () => {
	const pdf = await createPdf([
		{ buffer: png, key: 'first' },
		{ buffer: png, key: 'second' },
	]);

	assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
	assert.equal(await getPageCount(pdf), 2);
});

test('merges every page from supplied PDF files', async () => {
	const pdf = await mergePdfs([
		{ buffer: await createSourcePdf(2), key: 'first' },
		{ buffer: await createSourcePdf(3), key: 'second' },
	]);

	assert.equal(await getPageCount(pdf), 5);
});

test('splits a PDF into one single-page PDF per page', async () => {
	const pages = await splitPdf(await createSourcePdf(3));

	assert.equal(pages.length, 3);
	assert.deepEqual(await Promise.all(pages.map(getPageCount)), [1, 1, 1]);
});

test('renders every PDF page as PNG or JPEG', async () => {
	const sourcePdf = await createSourcePdf(2);
	const pngPages = await renderPdfPages(sourcePdf, 'png', 1, 0.9);
	const jpegPages = await renderPdfPages(sourcePdf, 'jpeg', 1, 0.9);

	assert.equal(pngPages.length, 2);
	assert.equal(pngPages[0].subarray(1, 4).toString(), 'PNG');
	assert.equal(jpegPages.length, 2);
	assert.deepEqual([...jpegPages[0].subarray(0, 2)], [0xff, 0xd8]);
});

test('rejects empty image and PDF lists', async () => {
	await assert.rejects(createPdf([]), /No image binary data was found/);
	await assert.rejects(mergePdfs([]), /No PDF binary data was found/);
});

function executionContext({
	action,
	items,
	buffers,
	keepSources = false,
	imageFormat = 'png',
	pdfName = 'output.pdf',
}) {
	return {
		continueOnFail: () => false,
		getInputData: () => items,
		getNode: () => ({
			name: 'PDF Actions',
			type: 'pdfActions',
			parameters: {
				action,
				imageFormat,
				jpegQuality: 90,
				keepSources,
				outputKey: 'data',
				pdfName,
				renderScale: 1,
			},
		}),
		getNodeParameter: (name) =>
			({
				action,
				imageFormat,
				jpegQuality: 90,
				keepSources,
				outputKey: 'data',
				pdfName,
				renderScale: 1,
			})[name],
		helpers: {
			getBinaryDataBuffer: async (itemIndex, key) => buffers[itemIndex][key],
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
		},
	};
}

function imageItems(count) {
	return Array.from({ length: count }, (_, index) => ({
		json: { index },
		binary: {
			image: {
				data: png.toString('base64'),
				mimeType: 'image/png',
				fileName: `${index}.png`,
			},
		},
	}));
}

test('multiple images to multiple PDFs returns one PDF per input item', async () => {
	const items = imageItems(5);
	const buffers = items.map(() => ({ image: png }));
	const [output] = await new PdfActions().execute.call(
		executionContext({ action: 'imagesToPdfs', items, buffers }),
	);

	assert.equal(output.length, 5);
	assert.deepEqual(
		output.map((item) => item.json.index),
		[0, 1, 2, 3, 4],
	);
	assert.deepEqual(
		output.map((item) => item.binary.data.fileName),
		['output_0.pdf', 'output_1.pdf', 'output_2.pdf', 'output_3.pdf', 'output_4.pdf'],
	);
});

test('multiple images to one PDF returns one five-page PDF', async () => {
	const items = imageItems(5);
	const buffers = items.map(() => ({ image: png }));
	const [output] = await new PdfActions().execute.call(
		executionContext({ action: 'imagesToOnePdf', items, buffers }),
	);
	const pdf = Buffer.from(output[0].binary.data.data, 'base64');

	assert.equal(output.length, 1);
	assert.equal(await getPageCount(pdf), 5);
});

test('multiple PDFs to one PDF preserves every source page', async () => {
	const firstPdf = await createSourcePdf(2);
	const secondPdf = await createSourcePdf(3);
	const items = [
		{
			json: { index: 0 },
			binary: {
				document: {
					data: firstPdf.toString('base64'),
					mimeType: 'application/pdf',
					fileName: 'first.pdf',
				},
			},
		},
		{
			json: { index: 1 },
			binary: {
				document: {
					data: secondPdf.toString('base64'),
					mimeType: 'application/pdf',
					fileName: 'second.pdf',
				},
			},
		},
	];
	const buffers = [{ document: firstPdf }, { document: secondPdf }];
	const [output] = await new PdfActions().execute.call(
		executionContext({ action: 'pdfsToOnePdf', items, buffers }),
	);
	const mergedPdf = Buffer.from(output[0].binary.data.data, 'base64');

	assert.equal(output.length, 1);
	assert.equal(await getPageCount(mergedPdf), 5);
});

test('one PDF to multiple PDFs returns numbered single-page outputs', async () => {
	const sourcePdf = await createSourcePdf(3);
	const items = [
		{
			json: { source: 'document' },
			binary: {
				document: {
					data: sourcePdf.toString('base64'),
					mimeType: 'application/pdf',
					fileName: 'source.pdf',
				},
			},
		},
	];
	const [output] = await new PdfActions().execute.call(
		executionContext({
			action: 'pdfToPdfs',
			items,
			buffers: [{ document: sourcePdf }],
			pdfName: 'document.pdf',
		}),
	);

	assert.equal(output.length, 3);
	assert.deepEqual(
		output.map((item) => Object.values(item.binary)[0].fileName),
		['document_0.pdf', 'document_1.pdf', 'document_2.pdf'],
	);
	for (const item of output) {
		const binary = Object.values(item.binary)[0];
		assert.equal(await getPageCount(Buffer.from(binary.data, 'base64')), 1);
	}
	assert.deepEqual(
		output.map((item) => Object.keys(item.binary)[0]),
		['data_0', 'data_1', 'data_2'],
	);
});

test('one PDF to multiple images returns numbered PNG outputs', async () => {
	const sourcePdf = await createSourcePdf(2);
	const items = [
		{
			json: { source: 'document' },
			binary: {
				document: {
					data: sourcePdf.toString('base64'),
					mimeType: 'application/pdf',
					fileName: 'source.pdf',
				},
			},
		},
	];
	const [output] = await new PdfActions().execute.call(
		executionContext({
			action: 'pdfToImages',
			items,
			buffers: [{ document: sourcePdf }],
			imageFormat: 'png',
			pdfName: 'page',
		}),
	);

	assert.equal(output.length, 2);
	assert.deepEqual(
		output.map((item) => Object.values(item.binary)[0].fileName),
		['page_0.png', 'page_1.png'],
	);
	assert.deepEqual(
		output.map((item) => Object.keys(item.binary)[0]),
		['data_0', 'data_1'],
	);
});
