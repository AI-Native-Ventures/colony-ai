//! The Colony ant as a menu-bar glyph.
//!
//! The geometry is the mark in `icons/colony-icon.svg` (the app icon without
//! its tile): three body circles and five quadratic limbs. It is rasterized
//! here as a black mask whose alpha is the shape, which is what macOS needs
//! for a template image that tints itself for light and dark menu bars. Kept
//! free of tray and window types so the shape is tested on every platform.

/// Pixel size of the glyph. macOS draws a tray icon 18pt tall, so the width
/// sets the aspect ratio and the padding below keeps the ant clear of the edge.
pub(crate) const WIDTH: u32 = 102;
pub(crate) const HEIGHT: u32 = 60;

/// Mark-space units covered by one pixel.
const UNITS_PER_PIXEL: f32 = 4.2;
/// Centre of the mark's drawn bounds (x 24..402, y 67..281).
const CENTER: (f32, f32) = (213.0, 174.0);
/// The app icon strokes limbs at 14; a little heavier holds up at menu-bar size.
const STROKE_WIDTH: f32 = 16.0;
/// Straight segments each curved limb is flattened into.
const LIMB_SEGMENTS: usize = 24;

/// Abdomen, thorax and head as (centre x, centre y, radius).
const BODY: [(f32, f32, f32); 3] = [
    (104.0, 172.0, 80.0),
    (226.0, 164.0, 52.0),
    (313.0, 148.0, 46.0),
];

/// Three legs and two antennae as quadratic curves: start, control, end.
const LIMBS: [[(f32, f32); 3]; 5] = [
    [(198.0, 201.0), (176.0, 230.0), (163.0, 265.0)],
    [(229.0, 211.0), (226.0, 243.0), (232.0, 274.0)],
    [(259.0, 190.0), (281.0, 221.0), (296.0, 252.0)],
    [(327.0, 114.0), (340.0, 82.0), (371.0, 74.0)],
    [(343.0, 126.0), (367.0, 106.0), (395.0, 105.0)],
];

type Point = (f32, f32);

fn distance(a: Point, b: Point) -> f32 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

fn distance_to_segment(point: Point, start: Point, end: Point) -> f32 {
    let along = (end.0 - start.0, end.1 - start.1);
    let length_squared = along.0 * along.0 + along.1 * along.1;
    if length_squared == 0.0 {
        return distance(point, start);
    }
    let progress = (((point.0 - start.0) * along.0 + (point.1 - start.1) * along.1)
        / length_squared)
        .clamp(0.0, 1.0);
    distance(
        point,
        (start.0 + along.0 * progress, start.1 + along.1 * progress),
    )
}

fn limb_point(limb: &[Point; 3], t: f32) -> Point {
    let [start, control, end] = limb;
    let (a, b, c) = ((1.0 - t) * (1.0 - t), 2.0 * (1.0 - t) * t, t * t);
    (
        a * start.0 + b * control.0 + c * end.0,
        a * start.1 + b * control.1 + c * end.1,
    )
}

/// Signed distance from `point` to the ant: negative inside, in mark units.
fn ant_distance(point: Point, limb_segments: &[(Point, Point)]) -> f32 {
    let body = BODY
        .iter()
        .map(|&(x, y, radius)| distance(point, (x, y)) - radius);
    let limbs = limb_segments
        .iter()
        .map(|&(start, end)| distance_to_segment(point, start, end) - STROKE_WIDTH / 2.0);
    body.chain(limbs).fold(f32::INFINITY, f32::min)
}

/// The glyph as RGBA: black everywhere, with the ant's anti-aliased coverage as alpha.
pub(crate) fn ant_template_rgba() -> Vec<u8> {
    let limb_segments: Vec<(Point, Point)> = LIMBS
        .iter()
        .flat_map(|limb| {
            (0..LIMB_SEGMENTS).map(move |index| {
                (
                    limb_point(limb, index as f32 / LIMB_SEGMENTS as f32),
                    limb_point(limb, (index + 1) as f32 / LIMB_SEGMENTS as f32),
                )
            })
        })
        .collect();

    let mut rgba = vec![0; (WIDTH * HEIGHT * 4) as usize];
    for pixel_y in 0..HEIGHT {
        for pixel_x in 0..WIDTH {
            let point = (
                CENTER.0 + (pixel_x as f32 + 0.5 - WIDTH as f32 / 2.0) * UNITS_PER_PIXEL,
                CENTER.1 + (pixel_y as f32 + 0.5 - HEIGHT as f32 / 2.0) * UNITS_PER_PIXEL,
            );
            let coverage =
                (0.5 - ant_distance(point, &limb_segments) / UNITS_PER_PIXEL).clamp(0.0, 1.0);
            rgba[((pixel_y * WIDTH + pixel_x) * 4 + 3) as usize] =
                (coverage * f32::from(u8::MAX)).round() as u8;
        }
    }
    rgba
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn alpha_at(rgba: &[u8], x: f32, y: f32) -> u8 {
        let pixel_x = ((x - CENTER.0) / UNITS_PER_PIXEL + WIDTH as f32 / 2.0) as u32;
        let pixel_y = ((y - CENTER.1) / UNITS_PER_PIXEL + HEIGHT as f32 / 2.0) as u32;
        rgba[((pixel_y * WIDTH + pixel_x) * 4 + 3) as usize]
    }

    #[test]
    fn glyph_is_a_black_template_mask() {
        let rgba = ant_template_rgba();

        assert_eq!(rgba.len(), (WIDTH * HEIGHT * 4) as usize);
        assert!(
            rgba.chunks(4).all(|pixel| pixel[..3] == [0, 0, 0]),
            "a template image carries its shape in alpha only"
        );
    }

    #[test]
    fn glyph_draws_the_colony_ant() {
        let rgba = ant_template_rgba();

        // Abdomen, thorax and head are solid.
        for (x, y) in [(104.0, 172.0), (226.0, 164.0), (313.0, 148.0)] {
            assert_eq!(alpha_at(&rgba, x, y), 255, "body at {x},{y}");
        }
        // A leg and the far tip of an antenna are drawn: only the ant has them.
        assert!(alpha_at(&rgba, 178.0, 231.0) > 200, "leg");
        assert!(alpha_at(&rgba, 371.0, 74.0) > 200, "antenna tip");
        // The old bee filled the top centre and had no limbs below the thorax.
        assert_eq!(alpha_at(&rgba, 213.0, 80.0), 0, "above the thorax");
        assert_eq!(alpha_at(&rgba, 320.0, 230.0), 0, "beside the legs");
    }

    #[test]
    fn glyph_keeps_clear_of_the_image_edge() {
        let rgba = ant_template_rgba();
        let drawn = |index: usize| rgba[index * 4 + 3] > 0;
        let columns = (0..WIDTH).filter(|&x| (0..HEIGHT).any(|y| drawn((y * WIDTH + x) as usize)));
        let rows = (0..HEIGHT).filter(|&y| (0..WIDTH).any(|x| drawn((y * WIDTH + x) as usize)));
        let (left, right) = (columns.clone().min(), columns.max());
        let (top, bottom) = (rows.clone().min(), rows.max());

        assert!(left.is_some_and(|x| x >= 2), "left edge {left:?}");
        assert!(
            right.is_some_and(|x| x + 3 <= WIDTH),
            "right edge {right:?}"
        );
        assert!(top.is_some_and(|y| y >= 2), "top edge {top:?}");
        assert!(
            bottom.is_some_and(|y| y + 3 <= HEIGHT),
            "bottom edge {bottom:?}"
        );
    }

    fn count_in(directory: &Path, needle: &str) -> usize {
        std::fs::read_dir(directory)
            .expect("source directory should be readable")
            .flatten()
            .map(|entry| {
                let path = entry.path();
                if path.is_dir() {
                    count_in(&path, needle)
                } else if path.extension().is_some_and(|extension| extension == "rs")
                    && path.file_name().is_some_and(|name| name != "tray_mark.rs")
                {
                    std::fs::read_to_string(&path)
                        .expect("source file should be readable")
                        .matches(needle)
                        .count()
                } else {
                    0
                }
            })
            .sum()
    }

    #[test]
    fn the_tray_is_created_once_by_one_call_site() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");

        assert_eq!(count_in(&source, "TrayIconBuilder::"), 1);
        assert_eq!(count_in(&source, "tray_menu::init("), 1);
    }
}
