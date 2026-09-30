// Screen-space Kuwahara filter over the live 3D pieces only (stencil 1, written by
// painted.gdshader): smooth shading turns into flat, brush-like patches like the
// painted plate. The plate itself (stencil 0) is left untouched.
shader_type spatial;
render_mode unshaded, depth_test_disabled, depth_draw_never, cull_disabled, skip_vertex_transform;
stencil_mode read, compare_equal, 1;

uniform sampler2D screen : hint_screen_texture, filter_linear;
uniform int radius = 2;

void vertex() {
	POSITION = vec4(VERTEX.xy * 2.0, 0.0, 1.0);
}

void fragment() {
	vec2 px = 1.0 / VIEWPORT_SIZE;
	vec3 mean[4];
	vec3 sq[4];
	for (int k = 0; k < 4; k++) { mean[k] = vec3(0.0); sq[k] = vec3(0.0); }
	for (int j = -radius; j <= radius; j++) {
		for (int i = -radius; i <= radius; i++) {
			vec3 c = texture(screen, SCREEN_UV + vec2(float(i), float(j)) * px).rgb;
			if (i <= 0 && j <= 0) { mean[0] += c; sq[0] += c * c; }
			if (i >= 0 && j <= 0) { mean[1] += c; sq[1] += c * c; }
			if (i <= 0 && j >= 0) { mean[2] += c; sq[2] += c * c; }
			if (i >= 0 && j >= 0) { mean[3] += c; sq[3] += c * c; }
		}
	}
	float n = float((radius + 1) * (radius + 1));
	float best = 1e9;
	vec3 col = vec3(0.0);
	for (int k = 0; k < 4; k++) {
		vec3 m = mean[k] / n;
		vec3 v = abs(sq[k] / n - m * m);
		float s = v.r + v.g + v.b;
		if (s < best) { best = s; col = m; }
	}
	ALBEDO = col;
}
