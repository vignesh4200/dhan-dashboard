// pdf-parse doesn't ship its own TypeScript types, and there's no
// separately-maintained types package we can rely on existing. This is a
// minimal ambient declaration covering only what we actually use (the
// default export as a function returning parsed text), so the build's
// type-checker knows its shape without needing another external dependency.
declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages?: number;
    numrender?: number;
    info?: any;
    metadata?: any;
    version?: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: any): Promise<PdfParseResult>;

  export = pdfParse;
}
