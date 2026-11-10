# outreach rules



- **Strict CSS Property Regex Matching**: When matching CSS properties in inline styles (e.g. detecting whether an element already defines `color`), anchor property names with boundary or delimiter patterns (e.g. `/(?:^|;)\s*color\s*:/i`). Unanchored patterns like `/color\s*:/` unintentionally match compound CSS properties such as `background-color`, `border-color`, `border-bottom-color`, and `text-decoration-color`, leading to skipped style transformations and accessibility contrast failures.
