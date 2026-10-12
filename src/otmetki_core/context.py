"""Conservative text deduplication with immutable source references."""

from __future__ import annotations

import json
import hashlib
import re
import unicodedata


def normalize_text(text: str, kind: str) -> str:
    normalized = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    return normalized.strip() if kind in {"table", "formula"} else re.sub(r"\s+", " ", normalized).strip()


def _scopes(blocks: list[dict]) -> list[tuple[str, str]]:
    chain = ""
    scopes = []
    for block in blocks:
        conditional = re.search(r"(?<!\w)(?:услови\w*|при|если|вариант\w*|для|if|when|case|condition\w*)(?!\w)", block["text"], re.IGNORECASE)
        if conditional:
            # There is no trustworthy section-boundary parser in this package.
            # Keep prior conditions for the whole material rather than silently
            # forgetting an applicability qualifier after a fixed lookbehind.
            value = json.dumps([chain, block["kind"], normalize_text(block["text"], block["kind"])], ensure_ascii=False)
            chain = hashlib.sha256(value.encode()).hexdigest()
        scopes.append((block.get("scope", ""), chain))
    return scopes


def build_context(materials: list[dict]) -> dict:
    unique, warnings, duplicates = {}, [], 0
    for material in materials:
        warnings.extend(f"{material['title']}: {warning}" for warning in material["warnings"])
        scopes = _scopes(material["blocks"])
        for index, block in enumerate(material["blocks"]):
            normalized = normalize_text(block["text"], block["kind"])
            if not normalized:
                continue
            key = (material["courseId"], block["kind"], normalized, scopes[index], (material["id"], index) if len(normalized) < 24 else None)
            source = {"materialId": material["id"], "title": material["title"], "version": material["version"], "blockId": block["id"]}
            source.update({key: block[key] for key in ("page", "slide") if key in block})
            if key in unique:
                unique[key]["sources"].append(source)
                if block.get("warning"):
                    unique[key]["warnings"] = list(dict.fromkeys([*unique[key]["warnings"], block["warning"]]))
                duplicates += 1
            else:
                unique[key] = {"text": block["text"], "kind": block["kind"], "sources": [source], "warnings": [block["warning"]] if block.get("warning") else []}
    return {"blocks": list(unique.values()), "duplicateCount": duplicates, "warnings": list(dict.fromkeys(warnings))}


def context_txt(materials: list[dict]) -> str:
    context = build_context(materials)
    lines = ["OTMETKI CORE · SELECTED MATERIALS", ""]
    for material in materials:
        lines.append(f"{material['title']} · v{material['version']} · {material['status']}")
    lines.extend(["", f"Exact repetitions removed: {context['duplicateCount']}. Originals are unchanged.", ""])
    if context["warnings"]:
        lines.extend(["LIMITATIONS", *["- " + warning for warning in context["warnings"]], ""])
    for block in context["blocks"]:
        refs = []
        for source in block["sources"]:
            locator = (f" · page {source['page']}" if "page" in source else "") + (f" · slide {source['slide']}" if "slide" in source else "")
            refs.append(f"{source['title']} · v{source['version']}{locator} · block {source['blockId']}")
        lines.append("Sources: " + "; ".join(refs))
        lines.extend("Note: " + warning for warning in block["warnings"])
        lines.extend([block["text"], ""])
    return "\n".join(lines) + "\n"
