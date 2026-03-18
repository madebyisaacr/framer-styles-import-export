import { framer, useIsAllowedTo } from "framer-plugin";
import { useEffect, useState } from "react";
import "./App.css";
import { StylesImportExportIcon } from "./Icons";
import SegmentedControl from "./SegmentedControl";
import { copyToClipboard } from "./utils";

void framer.showUI({
	position: "top right",
	width: 260,
	height: 370,
});

type ExportSettings = {
	exportFormat: "csv" | "json";
	exportColorStyles: boolean;
	exportTextStyles: boolean;
};

const EXPORT_SETTINGS_STORAGE_KEY = "framer-styles-import-export.export-settings";

function readExportSettings(): Partial<ExportSettings> {
	try {
		if (typeof window === "undefined" || !("localStorage" in window)) return {};
		const raw = window.localStorage.getItem(EXPORT_SETTINGS_STORAGE_KEY);
		if (!raw) return {};

		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};

		const maybe = parsed as Partial<ExportSettings>;
		return {
			exportFormat:
				maybe.exportFormat === "csv" || maybe.exportFormat === "json"
					? maybe.exportFormat
					: undefined,
			exportColorStyles:
				typeof maybe.exportColorStyles === "boolean" ? maybe.exportColorStyles : undefined,
			exportTextStyles:
				typeof maybe.exportTextStyles === "boolean" ? maybe.exportTextStyles : undefined,
		};
	} catch {
		// If parsing fails for any reason, fall back to defaults.
		return {};
	}
}

function writeExportSettings(settings: ExportSettings) {
	try {
		if (typeof window === "undefined" || !("localStorage" in window)) return;
		window.localStorage.setItem(EXPORT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Best-effort persistence; ignore write failures (e.g. private mode).
	}
}

function getInitialExportSettings(): ExportSettings {
	const partial = readExportSettings();

	const exportFormat: ExportSettings["exportFormat"] = partial.exportFormat ?? "csv";
	let exportColorStyles: boolean = partial.exportColorStyles ?? true;
	let exportTextStyles: boolean = partial.exportTextStyles ?? true;

	// Avoid the "both disabled" state after reload: fall back to enabling both.
	if (!exportColorStyles && !exportTextStyles) {
		exportColorStyles = true;
		exportTextStyles = true;
	}

	return { exportFormat, exportColorStyles, exportTextStyles };
}

export function App() {
	const isAllowedToImport = useIsAllowedTo(
		"createColorStyle",
		"createTextStyle",
		"ColorStyle.setAttributes",
		"TextStyle.setAttributes"
	);

	const [view, setView] = useState<"home" | "export">("home");
	const [exportSettings, setExportSettings] = useState<ExportSettings>(() =>
		getInitialExportSettings()
	);
	const { exportFormat, exportColorStyles, exportTextStyles } = exportSettings;

	// Keep export settings consistent across reloads.
	useEffect(() => {
		writeExportSettings(exportSettings);
	}, [exportSettings]);

	const onHomeExportClick = () => {
		setView("export");
	};

	const onImportClick = () => {
		framer.notify("Import");
	};

	const buildExportStrings = async (includeColorStyles: boolean, includeTextStyles: boolean) => {
		const colorStyles = includeColorStyles ? await framer.getColorStyles() : [];
		const textStyles = includeTextStyles ? await framer.getTextStyles() : [];

		const normalizedColorStyles = colorStyles.map((style) => ({
			id: String(style.id),
			// Export `path` as `name` (without leading `/`), and omit the original `style.name`.
			name: stripLeadingSlash(style.path),
			light: convertRgbToHex(style.light),
			dark: convertRgbToHex(style.dark),
		}));

		const normalizedTextStyles = textStyles.map((style) => ({
			id: String(style.id),
			// Export `path` as `name` (without leading `/`), and omit the original `style.name`.
			name: stripLeadingSlash(style.path),

			tag: style.tag,

			font: style.font.selector,
			boldFont: style.boldFont ? style.boldFont.selector : null,
			italicFont: style.italicFont ? style.italicFont.selector : null,
			boldItalicFont: style.boldItalicFont ? style.boldItalicFont.selector : null,

			// `ColorStyle | string`
			// - If it's a ColorStyle token, export it as { id, name }.
			// - If it's a literal string, export as (possibly converted) string.
			color: serializeColorLike(style.color),

			transform: style.transform,
			alignment: style.alignment,
			decoration: style.decoration,
			decorationColor: serializeColorLike(style.decorationColor),

			decorationThickness: style.decorationThickness,
			decorationStyle: style.decorationStyle,
			decorationSkipInk: style.decorationSkipInk,
			decorationOffset: style.decorationOffset,

			balance: style.balance,
			minWidth: style.minWidth,

			fontSize: style.fontSize,
			letterSpacing: style.letterSpacing,
			lineHeight: style.lineHeight,
			paragraphSpacing: style.paragraphSpacing,

			// Export breakpoints (skip exporting breakpoints styling beyond
			// the breakpoint-specific typography fields for now).
			breakpoints: style.breakpoints.map((bp) => ({
				minWidth: bp.minWidth,
				fontSize: bp.fontSize,
				letterSpacing: bp.letterSpacing,
				lineHeight: bp.lineHeight,
				paragraphSpacing: bp.paragraphSpacing,
			})),
		}));

		const colorCsv = includeColorStyles ? toColorStylesCsv(normalizedColorStyles) : "";
		const textCsv = includeTextStyles ? toTextStylesCsv(normalizedTextStyles) : "";

		const stylesJsonPayload =
			includeColorStyles && includeTextStyles
				? {
						colorStyles: normalizedColorStyles,
						textStyles: normalizedTextStyles,
					}
				: includeColorStyles
					? normalizedColorStyles
					: normalizedTextStyles;

		const stylesJson = JSON.stringify(stylesJsonPayload, null, 2);

		return { colorCsv, textCsv, stylesJson };
	};

	const onCopyExportClick = async () => {
		try {
			if (!exportColorStyles && !exportTextStyles) {
				framer.notify("Select at least one style type");
				return;
			}

			const { colorCsv, textCsv, stylesJson } = await buildExportStrings(
				exportColorStyles,
				exportTextStyles
			);

			if (exportFormat === "csv") {
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
			const { colorCsv, textCsv, stylesJson } = await buildExportStrings(
				exportColorStyles,
				exportTextStyles
			);

			if (exportFormat === "csv") {
				// When exporting both color and text styles as CSV, download them as two files.
				if (exportColorStyles) {
					downloadFile("color-styles.csv", colorCsv, "text/csv;charset=utf-8");
				}

				if (exportTextStyles) {
					downloadFile("text-styles.csv", textCsv, "text/csv;charset=utf-8");
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
						onChange={(value) =>
							setExportSettings((s) => ({ ...s, exportColorStyles: value === "true" }))
						}
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
						onChange={(value) =>
							setExportSettings((s) => ({ ...s, exportTextStyles: value === "true" }))
						}
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
						onChange={(value) =>
							setExportSettings((s) => ({ ...s, exportFormat: value as "csv" | "json" }))
						}
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

function serializeColorLike(value: unknown): string | { id: string; name: string } | null {
	if (typeof value === "string") {
		return convertRgbToHex(value);
	}

	// Best-effort serialization for `ColorStyle` token objects.
	// Export as `{ id, name }` where `name` is the token `path` without a leading `/`.
	if (value && typeof value === "object") {
		const maybe = value as { path?: unknown; id?: unknown };
		const id = maybe.id != null ? String(maybe.id) : null;
		const name = typeof maybe.path === "string" ? stripLeadingSlash(maybe.path) : null;

		if (id && name) return { id, name };
		if (name) return name;
		if (id) return id;
	}

	return null;
}

function toTextStylesCsv(
	textStyles: Array<{
		id: string;
		name: string;

		tag: string;

		font: string;
		boldFont: string | null;
		italicFont: string | null;
		boldItalicFont: string | null;

		color: string | { id: string; name: string } | null;
		transform: string;
		alignment: string;
		decoration: string;
		decorationColor: string | { id: string; name: string } | null;

		decorationThickness: string;
		decorationStyle: string;
		decorationSkipInk: string;
		decorationOffset: string;

		balance: boolean;
		minWidth: number;
		fontSize: string;
		letterSpacing: string;
		lineHeight: string;
		paragraphSpacing: number;
		breakpoints: Array<{
			minWidth: number;
			fontSize: string;
			letterSpacing: string;
			lineHeight: string;
			paragraphSpacing: number;
		}>;
	}>
) {
	const isColorObject = (
		value: string | { id: string; name: string } | null
	): value is { id: string; name: string } => typeof value === "object" && value !== null;

	const hasColor = textStyles.some((s) => s.color !== null);
	const hasColorId = textStyles.some((s) => isColorObject(s.color) && s.color.id !== null);
	const hasColorName = textStyles.some((s) => isColorObject(s.color) && s.color.name !== null);

	const hasDecorationColor = textStyles.some((s) => s.decorationColor !== null);
	const hasDecorationColorId = textStyles.some(
		(s) => isColorObject(s.decorationColor) && s.decorationColor.id !== null
	);
	const hasDecorationColorName = textStyles.some(
		(s) => isColorObject(s.decorationColor) && s.decorationColor.name !== null
	);

	const hasBreakpoints = textStyles.some((s) => s.breakpoints.length > 0);
	const maxBreakpoints = hasBreakpoints
		? Math.max(...textStyles.map((s) => s.breakpoints.length))
		: 0;

	const headers: string[] = [
		"id",
		"name",
		"tag",
		"font",
		"boldFont",
		"italicFont",
		"boldItalicFont",
	];

	if (hasColor) headers.push("color");
	if (hasColorId) headers.push("color.id");
	if (hasColorName) headers.push("color.name");

	headers.push("transform", "alignment", "decoration");

	if (hasDecorationColor) headers.push("decorationColor");
	if (hasDecorationColorId) headers.push("decorationColor.id");
	if (hasDecorationColorName) headers.push("decorationColor.name");

	headers.push(
		"decorationThickness",
		"decorationStyle",
		"decorationSkipInk",
		"decorationOffset",
		"balance",
		"minWidth",
		"fontSize",
		"letterSpacing",
		"lineHeight",
		"paragraphSpacing"
	);

	if (hasBreakpoints) {
		for (let i = 1; i <= maxBreakpoints; i++) {
			headers.push(
				`breakpoint${i}.minWidth`,
				`breakpoint${i}.fontSize`,
				`breakpoint${i}.letterSpacing`,
				`breakpoint${i}.lineHeight`,
				`breakpoint${i}.paragraphSpacing`
			);
		}
	}

	const asCsvValue = (v: string | number | boolean | null) => {
		if (v === null) return "null";
		return String(v);
	};

	return [
		headers.join(","),
		...textStyles.map((style) => {
			const row: Array<string | number | boolean | null> = [
				style.id,
				style.name,
				style.tag,
				style.font,
				style.boldFont,
				style.italicFont,
				style.boldItalicFont,
			];

			if (hasColor) {
				if (style.color === null) row.push(null);
				else if (typeof style.color === "string") row.push(style.color);
				// When `color` is a `{ id, name }` token object, keep this column null.
				else row.push(null);
			}

			if (hasColorId) row.push(isColorObject(style.color) ? style.color.id : null);
			if (hasColorName) row.push(isColorObject(style.color) ? style.color.name : null);

			row.push(style.transform, style.alignment, style.decoration);

			if (hasDecorationColor) {
				if (style.decorationColor === null) row.push(null);
				else if (typeof style.decorationColor === "string") row.push(style.decorationColor);
				// When `decorationColor` is a `{ id, name }` token object, keep this column null.
				else row.push(null);
			}

			if (hasDecorationColorId)
				row.push(isColorObject(style.decorationColor) ? style.decorationColor.id : null);
			if (hasDecorationColorName)
				row.push(isColorObject(style.decorationColor) ? style.decorationColor.name : null);

			row.push(
				style.decorationThickness,
				style.decorationStyle,
				style.decorationSkipInk,
				style.decorationOffset,
				style.balance,
				style.minWidth,
				style.fontSize,
				style.letterSpacing,
				style.lineHeight,
				style.paragraphSpacing
			);

			if (hasBreakpoints) {
				for (let i = 0; i < maxBreakpoints; i++) {
					const bp = style.breakpoints[i];
					row.push(
						bp ? bp.minWidth : null,
						bp ? bp.fontSize : null,
						bp ? bp.letterSpacing : null,
						bp ? bp.lineHeight : null,
						bp ? bp.paragraphSpacing : null
					);
				}
			}

			return row
				.map((v) => escapeCsvValue(asCsvValue(v as string | number | boolean | null)))
				.join(",");
		}),
	].join("\n");
}
