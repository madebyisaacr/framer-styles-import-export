import { framer, useIsAllowedTo } from "framer-plugin";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
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

	const importFileInputRef = useRef<HTMLInputElement | null>(null);

	const onImportClick = () => {
		importFileInputRef.current?.click();
	};

	const readFileAsText = (file: File) =>
		new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result ?? ""));
			reader.onerror = () => reject(reader.error);
			reader.readAsText(file);
		});

	const onImportFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		try {
			framer.notify("Importing...");

			const raw = await readFileAsText(file);
			const parsed: unknown = JSON.parse(raw);

			const importedColorStyles = normalizeImportedColorStyles(parsed);
			const importedTextStyles = normalizeImportedTextStyles(parsed);

			if (importedColorStyles.length === 0 && importedTextStyles.length === 0) {
				framer.notify("No styles found in JSON");
				return;
			}

			const colorCreatedUpdatedUnchanged = {
				created: 0,
				updated: 0,
				unchanged: 0,
			};

			let colorsAfterImport = await framer.getColorStyles();

			if (importedColorStyles.length > 0) {
				const byId = new Map<string, (typeof colorsAfterImport)[number]>();
				const byPath = new Map<string, (typeof colorsAfterImport)[number]>();

				for (const style of colorsAfterImport) {
					byId.set(String(style.id), style);
					byPath.set(stripLeadingSlash(style.path), style);
				}

				for (const importedStyle of importedColorStyles) {
					const match = byId.get(importedStyle.id) ?? byPath.get(importedStyle.name);

					if (match) {
						const updates: { light?: string; dark?: string | null; path?: string } = {};

						if (match.light !== importedStyle.light) {
							updates.light = importedStyle.light;
						}

						const matchDark = match.dark ?? null;
						if (matchDark !== importedStyle.dark) {
							updates.dark = importedStyle.dark;
						}

						const matchName = stripLeadingSlash(match.path);
						if (matchName !== importedStyle.name) {
							updates.path = importedStyle.name;
						}

						if (Object.keys(updates).length > 0) {
							await match.setAttributes(updates);
							colorCreatedUpdatedUnchanged.updated++;
						} else {
							colorCreatedUpdatedUnchanged.unchanged++;
						}
					} else {
						await framer.createColorStyle({
							light: importedStyle.light,
							dark: importedStyle.dark,
							path: importedStyle.name,
						});
						colorCreatedUpdatedUnchanged.created++;
					}
				}

				// Re-fetch so text imports can resolve updated/missing color tokens.
				colorsAfterImport = await framer.getColorStyles();
			}

			const textCreatedUpdatedUnchanged = {
				created: 0,
				updated: 0,
				unchanged: 0,
			};

			if (importedTextStyles.length > 0) {
				const existingText = await framer.getTextStyles();

				const byId = new Map<string, (typeof existingText)[number]>();
				const byPath = new Map<string, (typeof existingText)[number]>();

				for (const style of existingText) {
					byId.set(String(style.id), style);
					byPath.set(stripLeadingSlash(style.path), style);
				}

				const fonts = await framer.getFonts();
				const byFontSelector = new Map<string, (typeof fonts)[number]>();
				for (const font of fonts) byFontSelector.set(font.selector, font);

				const byColorId = new Map<string, (typeof colorsAfterImport)[number]>();
				const byColorPath = new Map<string, (typeof colorsAfterImport)[number]>();
				for (const c of colorsAfterImport) {
					byColorId.set(String(c.id), c);
					byColorPath.set(stripLeadingSlash(c.path), c);
				}

				const resolveFont = (selector: string | null): (typeof fonts)[number] | null => {
					if (!selector) return null;
					return byFontSelector.get(selector) ?? null;
				};

				type ImportedColorRef = { id: string; name: string; color: string | null } | string | null;

				const canonicalColorRef = (
					ref: ImportedColorRef
				):
					| { kind: "null" }
					| { kind: "color"; id: string }
					| { kind: "literal"; value: string } => {
					if (ref === null) return { kind: "null" };
					if (typeof ref === "string") {
						const maybeId = byColorId.get(ref);
						if (maybeId) return { kind: "color", id: String(maybeId.id) };
						const maybeByPath = byColorPath.get(stripLeadingSlash(ref));
						if (maybeByPath) return { kind: "color", id: String(maybeByPath.id) };
						return { kind: "literal", value: String(convertRgbToHex(ref)) };
					}

					const byId = byColorId.get(ref.id);
					if (byId) return { kind: "color", id: String(byId.id) };
					const byPath = byColorPath.get(stripLeadingSlash(ref.name));
					if (byPath) return { kind: "color", id: String(byPath.id) };
					return {
						kind: "literal",
						value: ref.color ?? stripLeadingSlash(ref.name),
					};
				};

				const canonicalProjectColor = (
					value: (typeof existingText)[number]["color"] | unknown
				):
					| { kind: "null" }
					| { kind: "color"; id: string }
					| { kind: "literal"; value: string } => {
					if (value === null) return { kind: "null" };
					if (typeof value === "string") {
						const maybeId = byColorId.get(value);
						if (maybeId) return { kind: "color", id: String(maybeId.id) };
						const maybeByPath = byColorPath.get(stripLeadingSlash(value));
						if (maybeByPath) return { kind: "color", id: String(maybeByPath.id) };
						return { kind: "literal", value: String(convertRgbToHex(value)) };
					}

					const maybeObj = value as Record<string, unknown>;
					const id = maybeObj.id != null ? String(maybeObj.id) : null;
					if (id) return { kind: "color", id };

					const path = typeof maybeObj.path === "string" ? stripLeadingSlash(maybeObj.path) : null;
					const byPath = path ? byColorPath.get(path) : undefined;
					if (byPath) return { kind: "color", id: String(byPath.id) };

					const light =
						typeof maybeObj.light === "string" ? String(convertRgbToHex(maybeObj.light)) : null;
					return { kind: "literal", value: light ?? path ?? "" };
				};

				const normalizeCurrentTextForCompare = (style: (typeof existingText)[number]) => {
					return {
						name: stripLeadingSlash(style.path),
						tag: style.tag,
						font: style.font.selector,
						boldFont: style.boldFont ? style.boldFont.selector : null,
						italicFont: style.italicFont ? style.italicFont.selector : null,
						boldItalicFont: style.boldItalicFont ? style.boldItalicFont.selector : null,
						color: canonicalProjectColor(style.color),
						transform: style.transform,
						alignment: style.alignment,
						decoration: style.decoration,
						decorationColor: canonicalProjectColor(style.decorationColor),
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
						breakpoints: style.breakpoints.map((bp) => ({
							minWidth: bp.minWidth,
							fontSize: bp.fontSize,
							letterSpacing: bp.letterSpacing,
							lineHeight: bp.lineHeight,
							paragraphSpacing: bp.paragraphSpacing,
						})),
					};
				};

				const buildTextAttributes = (
					importedStyle: ReturnType<typeof normalizeImportedTextStyles>[number]
				) => {
					const resolvedFont = resolveFont(importedStyle.font);
					const resolvedBoldFont = resolveFont(importedStyle.boldFont);
					const resolvedItalicFont = resolveFont(importedStyle.italicFont);
					const resolvedBoldItalicFont = resolveFont(importedStyle.boldItalicFont);

					if (!resolvedFont) {
						throw new Error(`Font not found for selector: ${importedStyle.font}`);
					}

					const resolveColorRef = (
						ref: ImportedColorRef
					): (typeof colorsAfterImport)[number] | string => {
						if (ref === null) throw new Error("Color reference is null");
						if (typeof ref === "string") {
							const byId = byColorId.get(ref);
							if (byId) return byId;
							const byPath = byColorPath.get(stripLeadingSlash(ref));
							if (byPath) return byPath;
							return String(convertRgbToHex(ref));
						}

						const byId = byColorId.get(ref.id);
						if (byId) return byId;
						const byPath = byColorPath.get(stripLeadingSlash(ref.name));
						if (byPath) return byPath;
						return ref.color ?? stripLeadingSlash(ref.name);
					};

					return {
						path: importedStyle.name,
						tag: importedStyle.tag,

						color: resolveColorRef(importedStyle.color),
						font: resolvedFont,
						boldFont: resolvedBoldFont,
						italicFont: resolvedItalicFont,
						boldItalicFont: resolvedBoldItalicFont,

						transform: importedStyle.transform,
						alignment: importedStyle.alignment,
						decoration: importedStyle.decoration,

						decorationColor: resolveColorRef(importedStyle.decorationColor),

						decorationThickness: importedStyle.decorationThickness,
						decorationStyle: importedStyle.decorationStyle,
						decorationSkipInk: importedStyle.decorationSkipInk,
						decorationOffset: importedStyle.decorationOffset,

						balance: importedStyle.balance,
						minWidth: importedStyle.minWidth,
						fontSize: importedStyle.fontSize,
						letterSpacing: importedStyle.letterSpacing,
						lineHeight: importedStyle.lineHeight,
						paragraphSpacing: importedStyle.paragraphSpacing,

						breakpoints: importedStyle.breakpoints.map((bp) => ({
							minWidth: bp.minWidth,
							fontSize: bp.fontSize,
							letterSpacing: bp.letterSpacing,
							lineHeight: bp.lineHeight,
							paragraphSpacing: bp.paragraphSpacing,
						})),
					} as Parameters<typeof framer.createTextStyle>[0];
				};

				for (const importedStyle of importedTextStyles) {
					const match = byId.get(importedStyle.id) ?? byPath.get(importedStyle.name);

					if (match) {
						const current = normalizeCurrentTextForCompare(match);
						const importedForCompare = {
							name: importedStyle.name,
							tag: importedStyle.tag,
							font: importedStyle.font,
							boldFont: importedStyle.boldFont,
							italicFont: importedStyle.italicFont,
							boldItalicFont: importedStyle.boldItalicFont,
							color: canonicalColorRef(importedStyle.color as ImportedColorRef),
							transform: importedStyle.transform,
							alignment: importedStyle.alignment,
							decoration: importedStyle.decoration,
							decorationColor: canonicalColorRef(importedStyle.decorationColor as ImportedColorRef),
							decorationThickness: importedStyle.decorationThickness,
							decorationStyle: importedStyle.decorationStyle,
							decorationSkipInk: importedStyle.decorationSkipInk,
							decorationOffset: importedStyle.decorationOffset,
							balance: importedStyle.balance,
							minWidth: importedStyle.minWidth,
							fontSize: importedStyle.fontSize,
							letterSpacing: importedStyle.letterSpacing,
							lineHeight: importedStyle.lineHeight,
							paragraphSpacing: importedStyle.paragraphSpacing,
							breakpoints: importedStyle.breakpoints.map((bp) => ({
								minWidth: bp.minWidth,
								fontSize: bp.fontSize,
								letterSpacing: bp.letterSpacing,
								lineHeight: bp.lineHeight,
								paragraphSpacing: bp.paragraphSpacing,
							})),
						};

						if (JSON.stringify(current) !== JSON.stringify(importedForCompare)) {
							const attributes = buildTextAttributes(importedStyle);
							await match.setAttributes(attributes);
							textCreatedUpdatedUnchanged.updated++;
						} else {
							textCreatedUpdatedUnchanged.unchanged++;
						}
					} else {
						const attributes = buildTextAttributes(importedStyle);
						await framer.createTextStyle(attributes);
						textCreatedUpdatedUnchanged.created++;
					}
				}
			}

			framer.notify(
				`Import complete: color ${colorCreatedUpdatedUnchanged.created} created, ${colorCreatedUpdatedUnchanged.updated} updated, ${colorCreatedUpdatedUnchanged.unchanged} unchanged; text ${textCreatedUpdatedUnchanged.created} created, ${textCreatedUpdatedUnchanged.updated} updated, ${textCreatedUpdatedUnchanged.unchanged} unchanged`
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(err);
			framer.notify(`Import failed: ${message}`);
		} finally {
			// Allow selecting the same file again.
			event.target.value = "";
		}
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

			<input
				ref={importFileInputRef}
				type="file"
				accept="application/json,.json"
				style={{ display: "none" }}
				onChange={onImportFileSelected}
			/>
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

function normalizeImportedColorStyles(
	input: unknown
): Array<{ id: string; name: string; light: string; dark: string | null }> {
	const stylesValue = Array.isArray(input)
		? input
		: typeof input === "object" && input !== null && "colorStyles" in input
			? (input as Record<string, unknown>).colorStyles
			: null;

	if (!Array.isArray(stylesValue)) return [];

	const out: Array<{ id: string; name: string; light: string; dark: string | null }> = [];

	for (const entry of stylesValue) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;

		if (typeof e.light !== "string") continue;

		const id = typeof e.id === "string" ? e.id : null;
		const nameRaw =
			typeof e.name === "string" ? e.name : typeof e.path === "string" ? e.path : null;
		const name = nameRaw ? stripLeadingSlash(nameRaw) : null;

		if (!id || !name) continue;

		const darkValue = e.dark === null || typeof e.dark === "string" ? e.dark : null;

		out.push({
			id,
			name,
			light: e.light,
			dark: darkValue,
		});
	}

	return out;
}

function normalizeImportedTextStyles(input: unknown): Array<{
	id: string;
	name: string;
	tag: string;

	font: string;
	boldFont: string | null;
	italicFont: string | null;
	boldItalicFont: string | null;

	color: { id: string; name: string; color: string | null } | string | null;

	transform: string;
	alignment: string;
	decoration: string;
	decorationColor: { id: string; name: string; color: string | null } | string | null;

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
}> {
	const stylesValue = Array.isArray(input)
		? input
		: typeof input === "object" && input !== null && "textStyles" in input
			? (input as Record<string, unknown>).textStyles
			: null;

	if (!Array.isArray(stylesValue)) return [];

	const out: Array<{
		id: string;
		name: string;
		tag: string;
		font: string;
		boldFont: string | null;
		italicFont: string | null;
		boldItalicFont: string | null;
		color: { id: string; name: string } | string | null;
		transform: string;
		alignment: string;
		decoration: string;
		decorationColor: { id: string; name: string } | string | null;
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
	}> = [];

	for (const entry of stylesValue) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;

		const id = typeof e.id === "string" ? e.id : null;
		const nameRaw =
			typeof e.name === "string" ? e.name : typeof e.path === "string" ? e.path : null;
		const name = nameRaw ? stripLeadingSlash(nameRaw) : null;
		if (!id || !name) continue;

		const tag = typeof e.tag === "string" ? e.tag : null;
		const font = typeof e.font === "string" ? e.font : null;
		if (!tag || !font) continue;

		const boldFont =
			typeof e.boldFont === "string" ? e.boldFont : e.boldFont === null ? null : null;
		const italicFont =
			typeof e.italicFont === "string" ? e.italicFont : e.italicFont === null ? null : null;
		const boldItalicFont =
			typeof e.boldItalicFont === "string"
				? e.boldItalicFont
				: e.boldItalicFont === null
					? null
					: null;

		const parseColorRef = (
			v: unknown
		): { id: string; name: string; color: string | null } | string | null => {
			if (v === null) return null;
			if (typeof v === "string") return v;
			if (v && typeof v === "object") {
				const r = v as Record<string, unknown>;
				const refId = typeof r.id === "string" ? r.id : null;
				const refNameRaw = typeof r.name === "string" ? r.name : null;
				const refName = refNameRaw ? stripLeadingSlash(refNameRaw) : null;
				const refColorRaw = typeof r.color === "string" ? r.color : null;
				const refColor = refColorRaw ? convertRgbToHex(refColorRaw) : null;

				if (refId && refName) return { id: refId, name: refName, color: refColor };
			}
			return null;
		};

		const color = parseColorRef(e.color);
		const decorationColor = parseColorRef(e.decorationColor);

		const transform = typeof e.transform === "string" ? e.transform : null;
		const alignment = typeof e.alignment === "string" ? e.alignment : null;
		const decoration = typeof e.decoration === "string" ? e.decoration : null;
		if (!transform || !alignment || !decoration) continue;

		const decorationThickness =
			typeof e.decorationThickness === "string" ? e.decorationThickness : null;
		const decorationStyle = typeof e.decorationStyle === "string" ? e.decorationStyle : null;
		const decorationSkipInk = typeof e.decorationSkipInk === "string" ? e.decorationSkipInk : null;
		const decorationOffset = typeof e.decorationOffset === "string" ? e.decorationOffset : null;
		if (!decorationThickness || !decorationStyle || !decorationSkipInk || !decorationOffset)
			continue;

		const balance = typeof e.balance === "boolean" ? e.balance : null;
		const minWidth = typeof e.minWidth === "number" ? e.minWidth : null;
		const fontSize = typeof e.fontSize === "string" ? e.fontSize : null;
		const letterSpacing = typeof e.letterSpacing === "string" ? e.letterSpacing : null;
		const lineHeight = typeof e.lineHeight === "string" ? e.lineHeight : null;
		const paragraphSpacing = typeof e.paragraphSpacing === "number" ? e.paragraphSpacing : null;
		if (
			balance === null ||
			minWidth === null ||
			fontSize === null ||
			letterSpacing === null ||
			lineHeight === null ||
			paragraphSpacing === null
		)
			continue;

		const breakpointsValue = Array.isArray(e.breakpoints) ? e.breakpoints : [];
		const breakpoints: Array<{
			minWidth: number;
			fontSize: string;
			letterSpacing: string;
			lineHeight: string;
			paragraphSpacing: number;
		}> = [];

		for (const bpEntry of breakpointsValue) {
			if (!bpEntry || typeof bpEntry !== "object") continue;
			const bp = bpEntry as Record<string, unknown>;
			const bpMinWidth = typeof bp.minWidth === "number" ? bp.minWidth : null;
			const bpFontSize = typeof bp.fontSize === "string" ? bp.fontSize : null;
			const bpLetterSpacing = typeof bp.letterSpacing === "string" ? bp.letterSpacing : null;
			const bpLineHeight = typeof bp.lineHeight === "string" ? bp.lineHeight : null;
			const bpParagraphSpacing =
				typeof bp.paragraphSpacing === "number" ? bp.paragraphSpacing : null;
			if (
				bpMinWidth === null ||
				!bpFontSize ||
				!bpLetterSpacing ||
				!bpLineHeight ||
				bpParagraphSpacing === null
			)
				continue;

			breakpoints.push({
				minWidth: bpMinWidth,
				fontSize: bpFontSize,
				letterSpacing: bpLetterSpacing,
				lineHeight: bpLineHeight,
				paragraphSpacing: bpParagraphSpacing,
			});
		}

		out.push({
			id,
			name,
			tag,
			font,
			boldFont,
			italicFont,
			boldItalicFont,
			color,
			transform,
			alignment,
			decoration,
			decorationColor,
			decorationThickness,
			decorationStyle,
			decorationSkipInk,
			decorationOffset,
			balance,
			minWidth,
			fontSize,
			letterSpacing,
			lineHeight,
			paragraphSpacing,
			breakpoints,
		});
	}

	return out;
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

function serializeColorLike(
	value: unknown
): string | { id: string; name: string; color: string | null } | null {
	if (typeof value === "string") {
		return convertRgbToHex(value);
	}

	// Best-effort serialization for `ColorStyle` token objects.
	// Export as `{ id, name, color }` where:
	// - `name` is the token `path` without a leading `/`
	// - `color` is the token `light` value
	if (value && typeof value === "object") {
		const maybe = value as { path?: unknown; id?: unknown; light?: unknown };
		const id = maybe.id != null ? String(maybe.id) : null;
		const name = typeof maybe.path === "string" ? stripLeadingSlash(maybe.path) : null;
		const color = typeof maybe.light === "string" ? convertRgbToHex(maybe.light) : null;

		if (id && name) return { id, name, color };
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

		color: string | { id: string; name: string; color: string | null } | null;
		transform: string;
		alignment: string;
		decoration: string;
		decorationColor: string | { id: string; name: string; color: string | null } | null;

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
		value: string | { id: string; name: string; color: string | null } | null
	): value is { id: string; name: string; color: string | null } =>
		typeof value === "object" && value !== null;

	const hasColor = textStyles.some(
		(s) => typeof s.color === "string" || (isColorObject(s.color) && s.color.color !== null)
	);
	const hasColorId = textStyles.some((s) => isColorObject(s.color) && s.color.id !== null);
	const hasColorName = textStyles.some((s) => isColorObject(s.color) && s.color.name !== null);

	const hasDecorationColor = textStyles.some(
		(s) =>
			typeof s.decorationColor === "string" ||
			(isColorObject(s.decorationColor) && s.decorationColor.color !== null)
	);
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
				// When `color` is a token object, export its `light` value into this column.
				else row.push(style.color.color);
			}

			if (hasColorId) row.push(isColorObject(style.color) ? style.color.id : null);
			if (hasColorName) row.push(isColorObject(style.color) ? style.color.name : null);

			row.push(style.transform, style.alignment, style.decoration);

			if (hasDecorationColor) {
				if (style.decorationColor === null) row.push(null);
				else if (typeof style.decorationColor === "string") row.push(style.decorationColor);
				// When `decorationColor` is a token object, export its `light` value into this column.
				else row.push(style.decorationColor.color);
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
