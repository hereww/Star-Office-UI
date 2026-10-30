"""Regression checks for neighbouring frames leaking into a floor-aligned crop."""
import unittest

from PIL import Image

from normalize_rock_room_band_sprites import crop_isolated_cell


class IsolatedSpriteCropTests(unittest.TestCase):
    def test_previous_row_and_adjacent_columns_cannot_bleed(self):
        # Opaque magenta in every neighbouring frame makes contamination
        # detectable without relying on the production sprites' exact colours.
        source = Image.new("RGBA", (30, 30), (255, 0, 255, 255))
        cell = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
        for y in range(2, 9):
            for x in range(2, 8):
                cell.putpixel((x, y), (30, 180, 90, 220))
        source.paste(cell, (10, 10))

        result = crop_isolated_cell(source, (10, 10, 20, 20), (7, 6, 23, 21))
        self.assertEqual(result.size, (16, 15))
        self.assertEqual(result.getpixel((5, 6)), (30, 180, 90, 220))
        self.assertEqual(result.getchannel("A").getbbox(), (5, 6, 11, 13))
        # All sides are tested; a row-only clamp would still leak neighbours.
        for y in range(result.height):
            for x in range(result.width):
                if x < 3 or x >= 13 or y < 4 or y >= 14:
                    self.assertEqual(result.getpixel((x, y)), (0, 0, 0, 0))
        resized = result.resize((8, 8), Image.Resampling.LANCZOS)
        for y in range(resized.height):
            for x in range(resized.width):
                red, green, blue, alpha = resized.getpixel((x, y))
                if alpha >= 16:
                    self.assertGreater(green, red)
                    self.assertGreater(green, blue)

    def test_in_cell_crop_preserves_rgba_and_original_coordinates(self):
        source = Image.new("RGBA", (30, 30))
        for y in range(30):
            for x in range(30):
                source.putpixel((x, y), (x * 5, y * 5, 37, 128))
        result = crop_isolated_cell(source, (10, 10, 20, 20), (11, 12, 18, 19))
        self.assertEqual(result.tobytes(), source.crop((11, 12, 18, 19)).tobytes())


if __name__ == "__main__":
    unittest.main()
