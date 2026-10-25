from PIL import Image
import sys

def make_transparent(input_path, output_path1, output_path2):
    img = Image.open(input_path).convert("RGBA")
    datas = img.getdata()

    newData = []
    # Look for pixels close to white
    for item in datas:
        # if r, g, b are all high, it's white/light background
        if item[0] > 230 and item[1] > 230 and item[2] > 230:
            newData.append((255, 255, 255, 0))
        else:
            newData.append(item)

    img.putdata(newData)
    
    img.save(output_path1, "PNG")
    img.save(output_path2, "PNG")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python make_transparent.py <input> <output1> <output2>")
        sys.exit(1)
    make_transparent(sys.argv[1], sys.argv[2], sys.argv[3])
