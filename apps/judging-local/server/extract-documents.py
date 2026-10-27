import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

path = Path(sys.argv[1])
pages = []
limit = 240000
if path.suffix.lower() == '.pdf':
    from pypdf import PdfReader
    document = PdfReader(str(path), strict=False)
    if len(document.pages) > 300:
        raise ValueError('Judging document exceeds 300 pages')
    for index, page in enumerate(document.pages):
        text = (page.extract_text() or '')[:limit]
        pages.append({'page': index + 1, 'text': text})
        limit -= len(text)
        if limit <= 0:
            break
elif path.suffix.lower() in ('.docx', '.pptx'):
    with zipfile.ZipFile(path) as package:
        names = ['word/document.xml'] if path.suffix.lower() == '.docx' else sorted(
            (name for name in package.namelist() if name.startswith('ppt/slides/slide') and name.endswith('.xml')),
            key=lambda name: int(Path(name).stem.replace('slide', '')))
        if sum(package.getinfo(name).file_size for name in names) > 16 * 1024 * 1024:
            raise ValueError('Expanded document XML exceeds 16 MiB')
        for index, name in enumerate(names):
            root = ET.fromstring(package.read(name))
            text = '\n'.join(element.text or '' for element in root.iter() if element.tag.endswith('}t'))[:limit]
            pages.append({'page': index + 1, 'text': text})
            limit -= len(text)
            if limit <= 0:
                break
print(json.dumps({'pages': pages, 'coverage': 'PDF pages' if path.suffix.lower() == '.pdf' else 'Slides' if path.suffix.lower() == '.pptx' else 'Document XML paragraphs; pagination unavailable'}, ensure_ascii=True))
