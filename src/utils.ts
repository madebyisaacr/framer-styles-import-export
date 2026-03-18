/**
 * Copy text to clipboard with optional HTML support
 */
export async function copyToClipboard(text: string, html: string | null = null): Promise<boolean> {
	// Check if the Clipboard API is available
	try {
		if (navigator.clipboard && window.isSecureContext) {
			if (html) {
				// Use the Clipboard API with HTML content
				const clipboardItem = new ClipboardItem({
					"text/html": new Blob([html], { type: "text/html" }),
					"text/plain": new Blob([text], { type: "text/plain" }),
				});
				await navigator.clipboard.write([clipboardItem]);
			} else {
				// Use the Clipboard API for plain text
				await navigator.clipboard.writeText(text);
			}
			return true;
		}
	} catch {
		// Silently fail for clipboard API errors
	}

	try {
		// Fallback for browsers that don't support Clipboard API
		const textArea = document.createElement("textarea");
		textArea.value = text;

		// Make the textarea out of viewport
		textArea.style.position = "fixed";
		textArea.style.left = "-999999px";
		textArea.style.top = "-999999px";
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();

		const successful = document.execCommand("copy");
		document.body.removeChild(textArea);

		return successful;
	} catch {
		return false;
	}
}
