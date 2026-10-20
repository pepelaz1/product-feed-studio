from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'kwork-cover.png'
OUT.parent.mkdir(exist_ok=True)

im = Image.new('RGB', (1320, 880), '#ecf4ed')
draw = ImageDraw.Draw(im)
font_dir = Path('C:/Windows/Fonts')
font = lambda name, size: ImageFont.truetype(str(font_dir / name), size)
bold = lambda size: font('arialbd.ttf', size)
regular = lambda size: font('arial.ttf', size)

draw.rounded_rectangle((55, 55, 1265, 825), radius=42, fill='#124a39')
draw.ellipse((880, -130, 1450, 450), outline='#317760', width=5)
draw.ellipse((980, -20, 1330, 330), outline='#317760', width=4)
draw.text((110, 112), 'FEED STUDIO', font=bold(30), fill='#a8dfba')
draw.text((108, 205), 'Прайс-листы', font=bold(91), fill='#ffffff')
draw.text((108, 319), 'поставщиков', font=bold(91), fill='#ffffff')
draw.text((112, 453), 'CSV  •  XLSX', font=bold(47), fill='#b9ebc7')
draw.text((112, 548), 'Очистка  /  проверка  /  выгрузка', font=regular(35), fill='#e3f4e7')

draw.rounded_rectangle((107, 691, 806, 752), radius=20, fill='#d6f0dd')
draw.text((130, 705), 'Готовый файл + отчёт об ошибках', font=bold(27), fill='#124a39')

draw.rounded_rectangle((865, 470, 1200, 717), radius=23, fill='#ffffff')
draw.rounded_rectangle((865, 470, 1200, 526), radius=22, fill='#e1f1e5')
draw.rectangle((865, 505, 1200, 526), fill='#e1f1e5')
draw.text((890, 484), 'АРТИКУЛ', font=bold(18), fill='#387856')
draw.text((1068, 484), 'ЦЕНА', font=bold(18), fill='#387856')
for y, sku, price in [(549, 'A-101', '1 290'), (606, 'B-205', '3 450'), (663, 'C-312', '790')]:
    draw.text((890, y), sku, font=regular(24), fill='#234536')
    draw.text((1070, y), price, font=bold(24), fill='#234536')
    if y < 663:
        draw.line((882, y + 39, 1183, y + 39), fill='#e7eee9', width=2)

im.save(OUT, optimize=True)
print(OUT)
