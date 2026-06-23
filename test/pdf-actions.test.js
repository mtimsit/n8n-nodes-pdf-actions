const assert = require('node:assert/strict');
const test = require('node:test');
const { PDFDocument } = require('pdf-lib');

const {
	createPdf,
	mergePdfs,
	normalizePdfName,
	PdfActions,
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

test('rejects empty image and PDF lists', async () => {
	await assert.rejects(createPdf([]), /No image binary data was found/);
	await assert.rejects(mergePdfs([]), /No PDF binary data was found/);
});

function executionContext({ action, items, buffers, keepSources = false }) {
	return {
		continueOnFail: () => false,
		getInputData: () => items,
		getNode: () => ({
			name: 'PDF Actions',
			type: 'pdfActions',
			parameters: {
				action,
				keepSources,
				outputKey: 'data',
				pdfName: 'output.pdf',
			},
		}),
		getNodeParameter: (name) =>
			({
				action,
				keepSources,
				outputKey: 'data',
				pdfName: 'output.pdf',
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
