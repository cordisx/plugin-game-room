export interface HtmlUi {
  format: 'html-v1'
  bridgeVersion: 1
  entry: string
  assets: Record<
    string,
    { mediaType: 'text/html' | 'text/css' | 'text/javascript' | 'image/svg+xml'; content: string; sha256: string }
  >
}
export const htmlUiLimits: Readonly<{ assets: number; assetBytes: number; totalBytes: number }>
export function parseHtmlUi(value: unknown): HtmlUi
export function verifyHtmlUi(value: unknown, sha256: (content: string) => string | Promise<string>): Promise<HtmlUi>
