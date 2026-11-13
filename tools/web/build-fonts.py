"""Convert the installed, licensed fonts inside the isolated build container."""
import sys
import json
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

source, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
for file in sorted(source.glob('*.ttf')):
    font = TTFont(file)
    original = set(font.getBestCmap())
    if file.name.startswith('Poppins_'):
        options = subset.Options()
        worker = subset.Subsetter(options=options)
        ranges = [(0, 0x250), (0x300, 0x400), (0x2000, 0x2070), (0x20A0, 0x20D0), (0x2190, 0x2300), (0x25A0, 0x2600)]
        worker.populate(unicodes=[point for start, end in ranges for point in range(start, end)])
        worker.subset(font)
        assert all(ord(char) in font.getBestCmap() for char in 'áéíóúüñÑ¿¡°0123456789'), 'Missing Spanish glyphs'
    else:
        required = set(json.loads(Path(sys.argv[3]).read_text()).values())
        worker = subset.Subsetter(options=subset.Options())
        worker.populate(unicodes=required)
        worker.subset(font)
        assert required <= set(font.getBestCmap()), 'Missing application icons'
    font.flavor = 'woff2'
    target = output / (file.stem + '.woff2')
    font.save(target)
    assert set(TTFont(target).getBestCmap()) == set(font.getBestCmap())
    print(target.name, target.stat().st_size)
