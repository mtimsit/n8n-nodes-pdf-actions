# n8n-nodes-pdf-actions

This n8n community node converts incoming binary images into PDF documents.

It supports two output modes:

- One PDF per input item.
- One merged PDF containing images from every input item.

## Installation

Install `n8n-nodes-pdf-actions` from **Settings > Community Nodes** in your self-hosted n8n instance.

## Usage

Connect a node that outputs images as binary data, then configure:

- **Merge Into One PDF**: when disabled, each input item produces its own PDF; when enabled, every image from every input item is added to one PDF.
- **Output Binary Field**: binary property receiving the generated PDF. The default is `data`.
- **PDF File Name**: output filename. The `.pdf` extension is added automatically when omitted.
- **Keep Source Images**: preserves image binaries alongside the generated PDF.

Images and pages keep the order in which n8n receives the items and their binary properties. Each PDF page uses the pixel dimensions of its source image.

## Example

With five input items containing one image each:

- **Merge Into One PDF** disabled: five output items containing one PDF each.
- **Merge Into One PDF** enabled: one output item containing a five-page PDF.

## Supported images

PDFKit supports JPEG and PNG images. Unsupported or invalid image data returns a node execution error.

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
