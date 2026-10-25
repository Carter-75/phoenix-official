import sys
import os
from rembg import remove
from PIL import Image

def process_image(input_path, output_path, max_size):
    try:
        print(f"Processing {input_path}...")
        # Load the input image
        input_image = Image.open(input_path)
        
        # Remove the background
        output_image = remove(input_image)
        
        # Get the bounding box of the non-transparent area
        bbox = output_image.getbbox()
        if bbox:
            # Crop the image to the bounding box
            output_image = output_image.crop(bbox)
        
        # Resize while maintaining aspect ratio
        output_image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        # Save the result
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        output_image.save(output_path, format="PNG")
        print(f"Successfully processed {input_path} -> {output_path}")
        
    except Exception as e:
        print(f"Error processing {input_path}: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python process_assets.py <input_path> <output_path> <max_size>")
        sys.exit(1)
        
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    size = int(sys.argv[3])
    
    process_image(in_path, out_path, size)
