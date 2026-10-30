"""Regression checks for RGBA preservation in the offline sprite exporter."""

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from normalize_full_frame_assets import normalize_cells, repeat_base


class FullFrameAlphaTests(unittest.TestCase):
    def test_translucent_rgb_and_alpha_survive_both_paste_stages(self):
        sprite = Image.new("RGBA", (3, 2))
        pixels = [(100, 120, 140, a) for a in (16, 32, 128, 180, 224, 253)]
        sprite.putdata(pixels)
        atlas = normalize_cells([sprite] * 12, (5, 7, 8, 9))
        for frame in range(12):
            x, y = (frame % 4) * 192 + 5, (frame // 4) * 192 + 7
            self.assertEqual([atlas.getpixel((x + dx, y + dy))
                              for dy in range(2) for dx in range(3)], pixels)
            self.assertEqual(atlas.getpixel((x - 1, y)), (0, 0, 0, 0))

    def test_static_rear_frame_preserves_semitransparent_source(self):
        with tempfile.TemporaryDirectory() as directory:
            base, output = Path(directory) / "base.png", Path(directory) / "frames.png"
            image = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
            image.putpixel((80, 90), (230, 140, 60, 128))
            image.save(base)
            repeat_base(base, output)
            with Image.open(output) as atlas:
                for frame in range(12):
                    self.assertEqual(atlas.getpixel(((frame % 4) * 192 + 80,
                                                     (frame // 4) * 192 + 90)),
                                     (230, 140, 60, 128))


if __name__ == "__main__":
    unittest.main()
