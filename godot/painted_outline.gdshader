// Dark painted edge: the back faces pushed out along the normals (inverted hull).
shader_type spatial;
render_mode unshaded, cull_front;

uniform vec4 color : source_color = vec4(0.23, 0.14, 0.1, 1.0);
uniform float width = 0.012;

void vertex() {
	VERTEX += normalize(NORMAL) * width;
}

void fragment() {
	ALBEDO = color.rgb;
}
