import json
from pathlib import Path
from typing import List, Dict, Any
import pandas as pd

EXPORTS_DIR = Path("./exports")

class DataExporter:
    @staticmethod
    def ensure_export_dir() -> Path:
        EXPORTS_DIR.mkdir(exist_ok=True)
        return EXPORTS_DIR

    @staticmethod
    def export_to_json(data: List[Dict[str, Any]], filename: str = "digiskills_lectures.json") -> str:
        out_dir = DataExporter.ensure_export_dir()
        file_path = out_dir / filename
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return str(file_path.resolve())

    @staticmethod
    def export_to_csv(data: List[Dict[str, Any]], filename: str = "digiskills_lectures.csv") -> str:
        out_dir = DataExporter.ensure_export_dir()
        file_path = out_dir / filename
        df = pd.DataFrame(data)
        df.to_csv(file_path, index=False, encoding="utf-8-sig")
        return str(file_path.resolve())

    @staticmethod
    def export_to_excel(data: List[Dict[str, Any]], filename: str = "digiskills_lectures.xlsx") -> str:
        out_dir = DataExporter.ensure_export_dir()
        file_path = out_dir / filename
        df = pd.DataFrame(data)
        
        # Use openpyxl writer with clickable YouTube hyperlinks
        with pd.ExcelWriter(file_path, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Lectures", index=False)
            worksheet = writer.sheets["Lectures"]
            
            # Format hyperlinked YouTube column if present
            if "youtube_url" in df.columns:
                yt_col_idx = df.columns.get_loc("youtube_url") + 1
                for row_idx in range(2, len(df) + 2):
                    cell = worksheet.cell(row=row_idx, column=yt_col_idx)
                    val = str(cell.value or "")
                    if val.startswith("http"):
                        cell.hyperlink = val
                        cell.style = "Hyperlink"

        return str(file_path.resolve())

    @staticmethod
    def export_to_txt(data: List[Dict[str, Any]], filename: str = "digiskills_lectures.txt") -> str:
        """Generates a well-formatted text report file in the ./exports folder."""
        out_dir = DataExporter.ensure_export_dir()
        file_path = out_dir / filename
        
        course_name = data[0].get("course_name", "DigiSkills Course") if data else "DigiSkills Course"
        total = len(data)
        
        lines = []
        lines.append("=" * 80)
        lines.append(f"                    DIGISKILLS LMS LECTURE LINKS REPORT")
        lines.append("=" * 80)
        lines.append(f"Course Title: {course_name}")
        lines.append(f"Total Lectures Extracted: {total}")
        lines.append("=" * 80)
        lines.append("")

        current_week = None
        for idx, item in enumerate(data, 1):
            week = item.get("week", "General")
            if week != current_week:
                current_week = week
                lines.append("")
                lines.append(f"[{current_week}]")
                lines.append("=" * 80)

            topic = item.get("topic_title", "N/A")
            duration = item.get("duration", "N/A")
            yt_url = item.get("youtube_url", "N/A")
            description = item.get("description", "N/A")

            lines.append(f"Lecture #{idx}: {topic}")
            lines.append(f"  • Duration:    {duration}")
            lines.append(f"  • YouTube URL: {yt_url}")
            if description and description != "N/A":
                lines.append(f"  • Description: {description}")
            lines.append("-" * 80)

        with open(file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        return str(file_path.resolve())

