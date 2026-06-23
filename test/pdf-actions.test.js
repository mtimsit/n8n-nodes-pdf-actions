const assert = require('node:assert/strict');
const test = require('node:test');

const {
	createPdf,
	normalizePdfName,
	PdfActions,
} = require('../dist/nodes/PdfActions/PdfActions.node.js');

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
);

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
	const pageCount = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;

	assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
	assert.equal(pageCount, 2);
});

test('rejects an empty image list', async () => {
	await assert.rejects(createPdf([]), /No image binary data was found/);
});

function executionContext(mergeAll) {
	const items = Array.from({ length: 5 }, (_, index) => ({
		json: { index },
		binary: {
			image: {
				data: png.toString('base64'),
				mimeType: 'image/png',
				fileName: `${index}.png`,
			},
		},
	}));

	return {
		continueOnFail: () => false,
		getInputData: () => items,
		getNode: () => ({ name: 'PDF Actions', type: 'pdfActions' }),
		getNodeParameter: (name) => ({
			keepImages: false,
			mergeAll,
			outputKey: 'data',
			pdfName: 'images.pdf',
		})[name],
		helpers: {
			getBinaryDataBuffer: async () => png,
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
		},
	};
}

test('returns one PDF for every input item when merge is disabled', async () => {
	const [output] = await new PdfActions().execute.call(executionContext(false));

	assert.equal(output.length, 5);
	assert.deepEqual(
		output.map((item) => item.json.index),
		[0, 1, 2, 3, 4],
	);
});

test('returns one five-page PDF when merge is enabled', async () => {
	const [output] = await new PdfActions().execute.call(executionContext(true));
	const pdf = Buffer.from(output[0].binary.data.data, 'base64');
	const pageCount = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;

	assert.equal(output.length, 1);
	assert.equal(pageCount, 5);
	assert.deepEqual(output[0].pairedItem, [
		{ item: 0 },
		{ item: 1 },
		{ item: 2 },
		{ item: 3 },
		{ item: 4 },
	]);
});
