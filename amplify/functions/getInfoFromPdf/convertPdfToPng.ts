import gm from 'gm';
import { PDFDocument } from 'pdf-lib';


const imageMagick = gm.subClass({ imageMagick: true });

async function convertPdfPageToPng(pdfBuffer: Buffer, index: number): Promise<Buffer> {
    // Load the PDF document
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    // Get the first page of the PDF
    const page = pdfDoc.getPages()[index];

    // Get the width and height of the page
    const { width, height } = page.getSize();
    const pngBuffer = await new Promise<Buffer>((resolve, reject) => {

        imageMagick(pdfBuffer, `pdf.pdf[${index}]`)
            .resize(width * 2, height * 2)
            .density(600, 600)
            .quality(100)
            .toBuffer('PNG', (err, out) => {
                if (err) {
                    // console.log('gm conversion error: ', err)
                    throw new Error('gm conversion error: ', err);
                }

                // console.log('out: ', out)

                resolve(out)
            });
    })

    return pngBuffer
}

export async function convertPdfToPngs(body: Buffer): Promise<Buffer[]> {
    try {
        const pdoc = await PDFDocument.load(body);
        const pageCount = pdoc.getPageCount();

        console.log(`Converting PDF to PNGs. Pages: ${pageCount}`);

        const pages = Array.from({ length: pageCount }, (_, i) => i);
        let pngBuffers: Buffer[] = [];
        for (let page of pages) {
            pngBuffers.push(await convertPdfPageToPng(body, page));
        }
        return pngBuffers;
    } catch (error) {
        console.error(JSON.stringify(error));
        throw new Error('Failed to convert PDF to images');
    }
}