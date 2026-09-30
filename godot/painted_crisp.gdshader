// The painted look without the painterly screen filter, for thin or small pieces
// (track, guests) that the filter would smear.
shader_type spatial;
render_mode ambient_light_disabled, specular_disabled;

#include "res://painted.gdshaderinc"
