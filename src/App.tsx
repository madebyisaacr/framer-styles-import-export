import { framer, useIsAllowedTo } from "framer-plugin";
import { useState } from "react";
import "./App.css";
import { StylesImportExportIcon } from "./Icons";
import SegmentedControl from "./SegmentedControl";
import { copyToClipboard } from "./utils";

void framer.showUI({
	position: "top right",
	width: 260,
	height: 370,
});

export function App() {
	const isAllowedToImport = useIsAllowedTo(
		"createColorStyle",
		"createTextStyle",
		"ColorStyle.setAttributes",
		"TextStyle.setAttributes"
	);

	const [view, setView] = useState<"home" | "export">("home");
	const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");

	const [exportColorStyles, setExportColorStyles] = useState(true);
	const [exportTextStyles, setExportTextStyles] = useState(true);

	const onHomeExportClick = () => {
		setView("export");
	};

	const onImportClick = () => {
		framer.notify("Import");
	};

	const buildExportStrings = async (includeColorStyles: boolean) => {
		const colorStyles = includeColorStyles ? await framer.getColorStyles() : [];

		const normalizedColorStyles = colorStyles.map((style) => ({
			id: String(style.id),
			// Export `path` as `name` (without leading `/`), and omit the original `style.name`.
			name: stripLeadingSlash(style.path),
			light: convertRgbToHex(style.light),
			dark: convertRgbToHex(style.dark),
		}));

		const colorCsv = toColorStylesCsv(normalizedColorStyles);

		const payload = {
			colorStyles: includeColorStyles ? normalizedColorStyles : [],
			textStyles: [],
		};

		const stylesJson = JSON.stringify(payload, null, 2);

		return { colorCsv, stylesJson };
	};

	const onCopyExportClick = async () => {
		try {
			if (!exportColorStyles && !exportTextStyles) {
				framer.notify("Select at least one style type");
				return;
			}

			const { colorCsv, stylesJson } = await buildExportStrings(exportColorStyles);

			if (exportFormat === "csv") {
				const textCsv = "";
				const parts: string[] = [];
				if (exportColorStyles) parts.push(colorCsv);
				if (exportTextStyles) parts.push(textCsv);

				const combined = parts.join("\n\n");
				const ok = await copyToClipboard(combined);
				framer.notify(ok ? "Copied" : "Copy failed");
			} else {
				const ok = await copyToClipboard(stylesJson);
				framer.notify(ok ? "Copied" : "Copy failed");
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(err);
			framer.notify(`Copy failed: ${message}`);
		}
	};

	const onDownloadExportClick = async () => {
		try {
			if (!exportColorStyles && !exportTextStyles) {
				framer.notify("Select at least one style type");
				return;
			}
			const { colorCsv, stylesJson } = await buildExportStrings(exportColorStyles);

			if (exportFormat === "csv") {
				// When exporting both color and text styles as CSV, download them as two files.
				if (exportColorStyles) {
					downloadFile("color-styles.csv", colorCsv, "text/csv;charset=utf-8");
				}

				// Text-style export intentionally left blank for now.
				if (exportTextStyles) {
					downloadFile("text-styles.csv", "", "text/csv;charset=utf-8");
				}
			} else {
				downloadFile("styles.json", stylesJson, "application/json;charset=utf-8");
			}

			framer.notify("Export complete");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(err);
			framer.notify(`Export failed: ${message}`);
		}
	};

	return view === "export" ? (
		<main>
			<hr />
			<div className="back-button" onClick={() => setView("home")}>
				<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
					<g transform="translate(1.5 1)">
						<path
							d="M 3.5 0 L 0 4 L 3.5 7.5"
							fill="transparent"
							strokeWidth="1.5"
							stroke="currentColor"
							strokeLinecap="round"
						></path>
					</g>
				</svg>
				Back
			</div>
			<div className="intro">
				<div className="asset">
					<StylesImportExportIcon />
				</div>
				<div className="text">
					<h4>Export Styles</h4>
					<p>Export color and text styles.</p>
				</div>
			</div>
			<div className="export-form">
				<div className="property-control">
					<p>Color Styles</p>
					<SegmentedControl
						items={[
							{ value: "true", label: "Yes" },
							{ value: "false", label: "No" },
						]}
						value={exportColorStyles ? "true" : "false"}
						onChange={(value) => setExportColorStyles(value === "true")}
					/>
				</div>
				<div className="property-control">
					<p>Text Styles</p>
					<SegmentedControl
						items={[
							{ value: "true", label: "Yes" },
							{ value: "false", label: "No" },
						]}
						value={exportTextStyles ? "true" : "false"}
						onChange={(value) => setExportTextStyles(value === "true")}
					/>
				</div>
				<div className="property-control">
					<p>Format</p>
					<SegmentedControl
						items={[
							{ value: "csv", label: "CSV" },
							{ value: "json", label: "JSON" },
						]}
						value={exportFormat}
						onChange={(value) => setExportFormat(value as "csv" | "json")}
					/>
				</div>
			</div>
			<div className="button-stack">
				<button
					type="button"
					onClick={onCopyExportClick}
					disabled={!exportColorStyles && !exportTextStyles}
				>
					Copy
				</button>
				<button
					type="button"
					className="framer-button-primary"
					onClick={onDownloadExportClick}
					disabled={!exportColorStyles && !exportTextStyles}
				>
					Download
				</button>
			</div>
		</main>
	) : (
		<main>
			<hr />
			<div className="intro">
				<div className="asset">
					<StylesImportExportIcon />
				</div>
				<div className="text">
					<h4>Styles Import & Export</h4>
					<p>Import and export color and text styles to CSV or JSON files.</p>
				</div>
			</div>

			<div className="button-stack">
				<button
					type="button"
					onClick={onImportClick}
					disabled={!isAllowedToImport}
					title={isAllowedToImport ? undefined : "Insufficient permissions"}
				>
					Import
				</button>

				<button type="button" className="framer-button-primary" onClick={onHomeExportClick}>
					Export
				</button>
			</div>
		</main>
	);
}

function downloadFile(filename: string, content: string, mimeType: string) {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);

	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;

	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();

	URL.revokeObjectURL(url);
}

function escapeCsvValue(value: string) {
	// CSV escaping: wrap in quotes if the value contains commas, quotes, or newlines.
	if (/[",\n]/.test(value)) {
		return `"${value.replaceAll('"', '""')}"`;
	}
	return value;
}

function stripLeadingSlash(value: string) {
	return value.startsWith("/") ? value.slice(1) : value;
}

function convertRgbToHex(value: string): string;
function convertRgbToHex(value: string | null): string | null;
function convertRgbToHex(value: string | null) {
	if (value === null) return null;
	// Only convert `rgb(r, g, b)` (not `rgba(...)`)
	if (!/^rgb\(/i.test(value) || /^rgba\(/i.test(value)) return value;

	const match = value.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
	if (!match) return value;

	const r = clampToByte(Number(match[1]));
	const g = clampToByte(Number(match[2]));
	const b = clampToByte(Number(match[3]));

	const toHex = (n: number) => n.toString(16).padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clampToByte(n: number) {
	return Math.min(255, Math.max(0, n));
}

function toColorStylesCsv(
	colorStyles: Array<{
		id: string;
		name: string;
		light: string;
		dark: string | null;
	}>
) {
	const headers = ["id", "name", "light", "dark"];

	return [
		headers.join(","),
		...colorStyles.map((style) => {
			const dark = style.dark === null ? "null" : style.dark;
			return [style.id, style.name, style.light, dark].map(escapeCsvValue).join(",");
		}),
	].join("\n");
}
