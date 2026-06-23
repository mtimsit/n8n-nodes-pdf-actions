# n8n-nodes-pdf-actions

This n8n community node converts images to PDF documents and merges existing PDF files.

## Actions

- **Multiple Images to Multiple PDFs**: creates one PDF for every incoming n8n item. Images on the same item become pages in that item's PDF.
- **Multiple Images to One PDF**: merges every incoming image into one PDF. This is the default action.
- **Multiple PDFs to One PDF**: merges every page from every incoming PDF into one document.

Input items and binary properties are processed in the order received from n8n.

## Installation

Install `n8n-nodes-pdf-actions` from **Settings > Community Nodes** in your self-hosted n8n instance.

## Configuration

- **Action**: operation performed by the node.
- **Output Binary Field**: binary property receiving the generated PDF. The default is `data`.
- **PDF File Name**: output filename. The `.pdf` extension is added automatically when omitted.
- **Keep Source Files**: preserves the source images or PDFs alongside the generated PDF.

## Examples

With five input items containing one image each:

- **Multiple Images to Multiple PDFs** returns five output items containing one PDF each.
- **Multiple Images to One PDF** returns one output item containing a five-page PDF.

With two PDFs containing two and three pages:

- **Multiple PDFs to One PDF** returns one five-page PDF.

## Supported files

Image conversion supports JPEG and PNG through PDFKit. PDF merging uses PDF-Lib. Invalid, encrypted, or unsupported files return a node execution error.

## Compatibility

This package uses the current `@n8n/node-cli` community-node structure and targets modern n8n 2.x installations.

## Development

```bash
npm install
npm run lint
npm test
npm run dev
```

## License

[MIT](LICENSE.md)
