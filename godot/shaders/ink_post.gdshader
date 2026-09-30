// Full-screen ink and grading pass. Lives on a 2x2 quad parented to the camera.
// Lines come from creases in the depth buffer (near side of silhouettes only,
// so they stay one stroke wide) and from sharp turns in the normal buffer.
// Then: warm lights / cool shade grading, a vignette and a little paper grain.
shader_type spatial;
render_mode unshaded, depth_test_disabled, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

uniform sampler2D screen_tex : hint_screen_texture, filter_nearest;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
uniform sampler2D normal_tex : hint_normal_roughness_texture, filter_nearest;
uniform vec4 ink : source_color = vec4(0.17, 0.11, 0.24, 1.0);
uniform float line_px = 1.5;
uniform float depth_sense = 0.012;
uniform float normal_sense = 0.62;
uniform float fade_start = 60.0;
uniform float fade_end = 120.0;
uniform float strength = 0.92;
uniform vec3 warm : source_color = vec3(1.0, 0.96, 0.9);
uniform vec3 cool : source_color = vec3(0.86, 0.88, 1.0);
uniform float saturation = 1.08;
uniform float vignette = 0.28;
uniform float grain = 0.025;
uniform int debug = 0;

void vertex() {
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
}

// View distance from the reverse-Z depth buffer (1 = near, 0 = far), using the
// camera's own planes (set from GDScript) so it holds for ortho and perspective.
uniform float cam_near = 0.05;
uniform float cam_far = 400.0;
uniform bool ortho = false;

float lin(vec2 uv, mat4 unused) {
	float d = texture(depth_tex, uv).r;
	if (ortho) {
		return mix(cam_far, cam_near, d);
	}
	return cam_near * cam_far / (d * (cam_far - cam_near) + cam_near);
}

vec3 nrm(vec2 uv) {
	return normalize(texture(normal_tex, uv).xyz * 2.0 - 1.0);
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 px = line_px / VIEWPORT_SIZE;
	mat4 ip = INV_PROJECTION_MATRIX;
	float d0 = lin(uv, ip);
	vec3 n0 = nrm(uv);
	vec2 dirs[4] = vec2[](vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(1.0, -1.0));
	float edge = 0.0;
	float e_d = 0.0;
	float e_n = 0.0;
	for (int i = 0; i < 4; i++) {
		vec2 o = dirs[i] * px;
		float da = lin(uv + o, ip);
		float db = lin(uv - o, ip);
		// Positive when both neighbours are further away: we're on the near side.
		float crease = (da + db - 2.0 * d0) / d0;
		float jump = max(da, db) - d0;
		float ed = smoothstep(depth_sense, depth_sense * 2.0, crease) * step(0.02 * d0, jump);
		e_d = max(e_d, ed);
		edge = max(edge, ed);
		float nd = max(1.0 - dot(n0, nrm(uv + o)), 1.0 - dot(n0, nrm(uv - o)));
		if (min(da, db) > d0 - 0.05 * d0) {
			float en = smoothstep(normal_sense, normal_sense + 0.15, nd);
			e_n = max(e_n, en);
			edge = max(edge, en);
		}
	}
	edge *= 1.0 - smoothstep(fade_start, fade_end, d0);
	vec3 col = texture(screen_tex, uv).rgb;
	vec3 line_col = mix(ink.rgb, col * 0.25, 0.3);
	col = mix(col, line_col, edge * strength);
	float lum = dot(col, vec3(0.299, 0.587, 0.114));
	col *= mix(cool, warm, smoothstep(0.08, 0.6, lum));
	col = mix(vec3(lum), col, saturation);
	vec2 c = uv - 0.5;
	col *= 1.0 - vignette * smoothstep(0.35, 0.85, length(c * vec2(1.25, 1.0)));
	col += (hash(FRAGCOORD.xy) - 0.5) * grain * (0.4 + lum);
	ALBEDO = max(col, vec3(0.0));
	if (debug == 1) { ALBEDO = vec3(e_d, e_n, fract(d0 * 0.1)); }
}
