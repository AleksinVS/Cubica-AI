#!/usr/bin/env python3
"""Read bounded XLSX worksheet rows without modifying the source workbook.

The repository intentionally does not require a general spreadsheet package
for this game-specific intake step. XLSX is an Open Packaging Convention ZIP
archive, so the Python standard library is sufficient for the small,
formula-free author workbook. This helper exposes only raw cells; JSON Schema
validation and game-specific interpretation remain in the Node.js importer.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024
MAX_ROWS_PER_SHEET = 10_000
MAX_CELLS = 100_000
MAX_TEXT_LENGTH = 20_000
CELL_REFERENCE = re.compile(r"^([A-Z]+)([1-9][0-9]*)$")


class WorkbookReadError(Exception):
    """Describe a stable, non-secret author-workbook intake failure."""


def qualified(namespace: str, name: str) -> str:
    """Return one ElementTree-qualified XML name."""

    return f"{{{namespace}}}{name}"


def column_index(reference: str) -> int:
    """Convert an Excel cell reference such as ``BC17`` to a zero-based column."""

    match = CELL_REFERENCE.fullmatch(reference)
    if match is None:
        raise WorkbookReadError(f'invalid cell reference "{reference}"')
    value = 0
    for character in match.group(1):
        value = value * 26 + ord(character) - ord("A") + 1
    return value - 1


def safe_member_path(target: str) -> str:
    """Resolve a workbook relationship target inside ``xl/`` without traversal."""

    candidate = PurePosixPath(target.lstrip("/"))
    if candidate.is_absolute() or ".." in candidate.parts:
        raise WorkbookReadError("worksheet relationship escapes the XLSX package")
    return str(candidate if candidate.parts[:1] == ("xl",) else PurePosixPath("xl") / candidate)


def parse_xml(package: ZipFile, member: str) -> ElementTree.Element:
    """Parse one required XML package member with a concise intake error."""

    try:
        return ElementTree.fromstring(package.read(member))
    except KeyError as error:
        raise WorkbookReadError(f'XLSX member "{member}" is missing') from error
    except ElementTree.ParseError as error:
        raise WorkbookReadError(f'XLSX member "{member}" contains invalid XML') from error


def shared_strings(package: ZipFile) -> list[str]:
    """Read the optional shared-string table used by ordinary Excel text cells."""

    if "xl/sharedStrings.xml" not in package.namelist():
        return []
    root = parse_xml(package, "xl/sharedStrings.xml")
    result: list[str] = []
    for item in root.findall(qualified(MAIN_NS, "si")):
        value = "".join(node.text or "" for node in item.iter(qualified(MAIN_NS, "t")))
        if len(value) > MAX_TEXT_LENGTH:
            raise WorkbookReadError("shared string exceeds the intake text limit")
        result.append(value)
    if len(result) > MAX_CELLS:
        raise WorkbookReadError("shared string table exceeds the intake limit")
    return result


def numeric_value(raw: str, reference: str) -> int | float:
    """Parse a finite cached numeric cell without silently coercing other text."""

    try:
        value = float(raw)
    except ValueError as error:
        raise WorkbookReadError(f'cell "{reference}" contains an invalid number') from error
    if not math.isfinite(value):
        raise WorkbookReadError(f'cell "{reference}" contains a non-finite number')
    return int(value) if value.is_integer() else value


def cell_value(cell: ElementTree.Element, strings: list[str]) -> Any:
    """Decode one formula-free cell into JSON-compatible scalar data."""

    reference = cell.attrib.get("r", "")
    if cell.find(qualified(MAIN_NS, "f")) is not None:
        # Cached formula results may be stale. The author source currently has
        # no formulas, so failing closed prevents importing an unverified value.
        raise WorkbookReadError(f'formula cell "{reference}" is not supported')
    kind = cell.attrib.get("t")
    raw_node = cell.find(qualified(MAIN_NS, "v"))
    raw = raw_node.text if raw_node is not None else None
    if kind == "inlineStr":
        inline = cell.find(qualified(MAIN_NS, "is"))
        value = "" if inline is None else "".join(
            node.text or "" for node in inline.iter(qualified(MAIN_NS, "t"))
        )
    elif raw is None:
        return None
    elif kind == "s":
        try:
            value = strings[int(raw)]
        except (ValueError, IndexError) as error:
            raise WorkbookReadError(f'cell "{reference}" has an invalid shared-string index') from error
    elif kind in ("str", "e"):
        value = raw
    elif kind == "b":
        if raw not in ("0", "1"):
            raise WorkbookReadError(f'cell "{reference}" contains an invalid boolean')
        return raw == "1"
    else:
        return numeric_value(raw, reference)
    if len(value) > MAX_TEXT_LENGTH:
        raise WorkbookReadError(f'cell "{reference}" exceeds the intake text limit')
    return value


def worksheet_rows(package: ZipFile, member: str, strings: list[str]) -> list[list[Any]]:
    """Read a worksheet as sparse rows padded only to their last populated cell."""

    root = parse_xml(package, member)
    sheet_data = root.find(qualified(MAIN_NS, "sheetData"))
    if sheet_data is None:
        raise WorkbookReadError(f'worksheet "{member}" has no sheetData')
    result: list[list[Any]] = []
    cell_count = 0
    for row in sheet_data.findall(qualified(MAIN_NS, "row")):
        if len(result) >= MAX_ROWS_PER_SHEET:
            raise WorkbookReadError(f'worksheet "{member}" exceeds the row limit')
        values: list[Any] = []
        for cell in row.findall(qualified(MAIN_NS, "c")):
            cell_count += 1
            if cell_count > MAX_CELLS:
                raise WorkbookReadError(f'worksheet "{member}" exceeds the cell limit')
            index = column_index(cell.attrib.get("r", ""))
            if index >= 256:
                raise WorkbookReadError(f'worksheet "{member}" exceeds the column limit')
            while len(values) <= index:
                values.append(None)
            values[index] = cell_value(cell, strings)
        while values and values[-1] is None:
            values.pop()
        result.append(values)
    return result


def read_workbook(source_path: Path) -> dict[str, Any]:
    """Return ordered sheet names and raw rows from one bounded XLSX file."""

    try:
        stat = source_path.stat()
    except OSError as error:
        raise WorkbookReadError(f'cannot stat workbook "{source_path}"') from error
    if not source_path.is_file() or stat.st_size <= 0 or stat.st_size > MAX_SOURCE_BYTES:
        raise WorkbookReadError("workbook size is outside the intake limit")
    try:
        with ZipFile(source_path) as package:
            if any(info.flag_bits & 0x1 for info in package.infolist()):
                raise WorkbookReadError("encrypted XLSX members are not supported")
            if sum(info.file_size for info in package.infolist()) > MAX_UNCOMPRESSED_BYTES:
                raise WorkbookReadError("uncompressed XLSX content exceeds the intake limit")
            workbook = parse_xml(package, "xl/workbook.xml")
            relationships = parse_xml(package, "xl/_rels/workbook.xml.rels")
            targets = {
                relation.attrib["Id"]: relation.attrib["Target"]
                for relation in relationships.findall(qualified(PACKAGE_REL_NS, "Relationship"))
                if "Id" in relation.attrib and "Target" in relation.attrib
            }
            strings = shared_strings(package)
            sheets_node = workbook.find(qualified(MAIN_NS, "sheets"))
            if sheets_node is None:
                raise WorkbookReadError("workbook has no sheets")
            sheets = []
            for sheet in sheets_node.findall(qualified(MAIN_NS, "sheet")):
                name = sheet.attrib.get("name")
                relationship_id = sheet.attrib.get(qualified(REL_NS, "id"))
                if not name or not relationship_id or relationship_id not in targets:
                    raise WorkbookReadError("workbook contains an unresolved worksheet")
                member = safe_member_path(targets[relationship_id])
                sheets.append({"name": name, "rows": worksheet_rows(package, member, strings)})
            return {"sheets": sheets}
    except BadZipFile as error:
        raise WorkbookReadError("source is not a valid XLSX ZIP package") from error


def main(argv: list[str]) -> int:
    """Execute the read-only JSON bridge used by the Node.js importer."""

    if len(argv) != 2:
        raise WorkbookReadError("usage: read-xlsx-rows.py <source.xlsx>")
    document = read_workbook(Path(argv[1]).resolve())
    json.dump(document, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except WorkbookReadError as error:
        sys.stderr.write(f"read-xlsx-rows: {error}\n")
        raise SystemExit(1)
