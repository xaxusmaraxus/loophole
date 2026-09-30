// Painted look for the live 3D pieces, so they sit in a painted plate: soft cel
// light with warm highlights and cool violet shadows, a rim light, extra
// saturation and a faint brush texture. Fully lit = the piece's own color, like
// the plate. An outline pass (painted_outline.gdshader) adds the dark edge.
shader_type spatial;
render_mode ambient_light_disabled, specular_disabled;
// Stencil 1 = gets the painterly screen filter (painterly_post.gdshader).
stencil_mode write, compare_always, 1;

#include "res://painted.gdshaderinc"
