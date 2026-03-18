import { framer, useIsAllowedTo } from "framer-plugin";
import { useState, useEffect } from "react";
import "./App.css";
import { StylesImportExportIcon } from "./Icons";
import SegmentedControl from "./SegmentedControl";

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

	const onExportClick = () => {
		framer.notify("Export");
	};

	return view === "export" ? (
		<main>
			<hr />
			<p onClick={() => setView("home")}>Back</p>
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
			<button type="button" className="framer-button-primary" onClick={onExportClick}>
				Export
			</button>
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
