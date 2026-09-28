"""Source-aware wrappers for the fixed Content Studio card templates."""
from __future__ import annotations

from html import escape

from .content_templates import (
    ContentEvent,
    blog_cover_html as _base_blog_cover_html,
    social_square_html as _base_social_square_html,
)


def _with_source_badges(html: str, event: ContentEvent) -> str:
    source_provider = escape(event.source_provider or event.provider_slug.upper())
    precision = (
        f"원문 소수 {event.precision_digits}자리"
        if event.precision_digits is not None else "원문 정밀도 확인"
    )
    metadata = (
        f'<div class="source-meta"><span class="verified">{escape(event.verification_label)}</span>'
        f'<span>{escape(event.source_label)}</span><span>{source_provider}</span>'
        f'<span>{escape(precision)}</span></div>'
    )
    style = """
.top-with-source { display:grid; grid-template-columns:1fr auto; gap:10px; }
.source-meta { grid-column:1/-1; display:flex; gap:8px; align-items:center; flex-wrap:wrap; color:#dce7f2; font-size:16px; font-weight:800; letter-spacing:0; }
.source-meta span { padding:4px 10px; border:1px solid rgba(255,255,255,.22); border-radius:999px; }
.source-meta .verified { border-color:rgba(255,189,82,.65); color:#ffd78f; }
"""
    html = html.replace(
        '<main class="card" data-content-card>',
        f'<main class="card" data-content-card data-source-class="{escape(event.source_class)}" '
        f'data-verification-status="{escape(event.verification_status)}">',
        1,
    )
    html = html.replace('<header class="top">', '<header class="top top-with-source">', 1)
    html = html.replace("  </header>", f"    {metadata}\n  </header>", 1)
    return html.replace("</style>", f"{style}</style>", 1)


def social_square_html(event: ContentEvent) -> str:
    return _with_source_badges(_base_social_square_html(event), event)


def blog_cover_html(event: ContentEvent) -> str:
    return _with_source_badges(_base_blog_cover_html(event), event)
