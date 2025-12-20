import json
import sys
from pathlib import Path

# Allow running without installing the package
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from docsheets.excel_renderer import render_excel
from docsheets.word_renderer import render_word
from docsheets.validators import parse_excel_spec, parse_doc_spec, validate_excel_file, validate_docx_file


def main():
    base = Path(__file__).parent
    out_dir = base / "out"
    out_dir.mkdir(exist_ok=True)

    excel_payload = json.loads((base / "example_excel_spec.json").read_text(encoding="utf-8"))
    doc_payload = json.loads((base / "example_doc_spec.json").read_text(encoding="utf-8"))

    excel_spec = parse_excel_spec(excel_payload)
    doc_spec = parse_doc_spec(doc_payload)

    xlsx_path = str(out_dir / "report.xlsx")
    docx_path = str(out_dir / "report.docx")

    render_excel(excel_spec, xlsx_path)
    render_word(doc_spec, docx_path)

    print("xlsx errors:", validate_excel_file(xlsx_path))
    print("docx errors:", validate_docx_file(docx_path))
    print("Wrote:", xlsx_path)
    print("Wrote:", docx_path)


if __name__ == "__main__":
    main()
