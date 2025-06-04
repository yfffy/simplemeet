#!/usr/bin/env python3
"""
Simple icon generator for SimpleMeet PWA
Creates basic colored square icons with the app initial 'S'
"""

import os
from PIL import Image, ImageDraw, ImageFont

def create_icon(size, output_path):
    """Create a simple icon with the letter S"""
    # Create a new image with blue background
    img = Image.new('RGB', (size, size), color='#007bff')
    draw = ImageDraw.Draw(img)
    
    # Try to use a better font, fallback to default
    try:
        # Calculate font size - roughly 60% of icon size
        font_size = int(size * 0.6)
        font = ImageFont.truetype("arial.ttf", font_size)
    except (OSError, IOError):
        # Fallback to default font
        font_size = int(size * 0.5)
        font = ImageFont.load_default()
    
    # Get text size for centering
    text = "S"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Calculate position to center the text
    x = (size - text_width) // 2
    y = (size - text_height) // 2 - bbox[1]  # Adjust for baseline
    
    # Draw the text
    draw.text((x, y), text, fill='white', font=font)
    
    # Add a subtle border
    draw.rectangle([0, 0, size-1, size-1], outline='#0056b3', width=2)
    
    # Save the image
    img.save(output_path, 'PNG', optimize=True)
    print(f"Created icon: {output_path} ({size}x{size})")

def main():
    """Generate all required PWA icons"""
    # Ensure icons directory exists
    icons_dir = 'static/icons'
    os.makedirs(icons_dir, exist_ok=True)
    
    # Icon sizes needed for PWA
    sizes = [72, 96, 128, 144, 152, 192, 384, 512]
    
    for size in sizes:
        filename = f"icon-{size}x{size}.png"
        output_path = os.path.join(icons_dir, filename)
        create_icon(size, output_path)
    
    # Create favicon
    create_icon(32, os.path.join(icons_dir, 'favicon-32x32.png'))
    create_icon(16, os.path.join(icons_dir, 'favicon-16x16.png'))
    
    # Create apple touch icon
    create_icon(180, os.path.join(icons_dir, 'apple-touch-icon.png'))
    
    print("\n✅ All PWA icons generated successfully!")
    print("📝 Note: These are basic placeholder icons.")
    print("🎨 Consider creating custom icons with a design tool for production.")

if __name__ == "__main__":
    main() 