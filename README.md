# n8n-nodes-pdf-actions

This n8n community node converts images to PDF documents and merges existing PDF files.

## Actions

- **Multiple Images to Multiple PDFs**: creates one PDF for every incoming n8n item. Images on the same item become pages in that item's PDF.
- **Multiple Images to One PDF**: merges every incoming image into one PDF. This is the default action.
- **Multiple PDFs to One PDF**: merges every page from every incoming PDF into one document.
- **One PDF to Multiple PDFs**: creates one single-page PDF for every source page.
- **One PDF to Multiple Images**: renders every source page as PNG or JPEG.

Input items and binary properties are processed in the order received from n8n.
Multiple outputs use zero-based numbered filenames such as `document_0.pdf`, `document_1.pdf`, or `page_0.png`.

## Installation

Install `n8n-nodes-pdf-actions` from **Settings > Community Nodes** in your self-hosted n8n instance.

## Configuration

- **Action**: operation performed by the node.
- **Output Binary Field**: binary property receiving the generated PDF. The default is `data`.
- **Output File Name**: output filename or base name for numbered multi-file outputs.
- **Image Format**: PNG or JPEG for PDF-to-image conversion.
- **Render Scale**: controls the dimensions and sharpness of rendered images.
- **JPEG Quality**: controls JPEG compression quality.
- **Keep Source Files**: preserves the source images or PDFs alongside the generated PDF.

## Examples

With five input items containing one image each:

- **Multiple Images to Multiple PDFs** returns five output items containing one PDF each.
- **Multiple Images to One PDF** returns one output item containing a five-page PDF.

With two PDFs containing two and three pages:

- **Multiple PDFs to One PDF** returns one five-page PDF.

With one three-page PDF:

- **One PDF to Multiple PDFs** returns `output_0.pdf`, `output_1.pdf`, and `output_2.pdf`.
- **One PDF to Multiple Images** returns three numbered PNG or JPEG files.

## Supported files

Image conversion supports JPEG and PNG through PDFKit. PDF merging uses PDF-Lib. Invalid, encrypted, or unsupported files return a node execution error.

## Compatibility

This package uses the current `@n8n/node-cli` community-node structure and targets modern n8n 2.x installations running Node.js 22.13 or newer.

## Development

```bash
npm install
npm run lint
npm test
npm run dev
```

## License

[MIT](LICENSE.md)
