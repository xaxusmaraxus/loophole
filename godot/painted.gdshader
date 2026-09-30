// Painted look for the live 3D pieces, so they sit in a painted plate: soft cel
// light with warm highlights and cool violet shadows, a rim light, extra
// saturation and a faint brush texture. Fully lit = the piece's own color, like
// the plate. An outline pass (painted_outline.gdshader) adds the dark edge.
shader_type spatial;
render_mode ambient_light_disabled, specular_disabled;

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, hint_default_white;
uniform bool use_vertex_color = false;
uniform float saturation = 1.35;
uniform vec3 light_tint : source_color = vec3(1.0, 0.97, 0.9);
uniform vec3 shadow_tint : source_color = vec3(0.6, 0.55, 0.78);
uniform float rim = 0.22;
uniform sampler2D brush : hint_default_white, repeat_enable;
uniform float brush_amount = 0.12;
// Ink edge drawn into the surface itself (for thin pieces like rails, where an
// outline hull is too coarse): darkens toward the silhouette.
uniform float ink = 0.0;

varying vec3 world_pos;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 c = albedo.rgb * texture(albedo_texture, UV).rgb;
	if (use_vertex_color) {
		c *= COLOR.rgb;
	}
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	c = max(mix(vec3(l), c, saturation), 0.0);
	// Brush strokes: stretched noise in world space, so pieces don't swim when they move... much.
	float b = texture(brush, world_pos.xz * vec2(1.6, 4.0) + world_pos.y * 2.0).r;
	c *= 1.0 - brush_amount * 0.5 + brush_amount * b;
	float edge = pow(1.0 - clamp(abs(dot(NORMAL, VIEW)), 0.0, 1.0), 2.0);
	c *= 1.0 - ink * edge;
	ALBEDO = c;
	ROUGHNESS = 1.0;
}

void light() {
	if (LIGHT_IS_DIRECTIONAL) {
		float ndl = dot(NORMAL, LIGHT);
		float lit = smoothstep(-0.1, 0.35, ndl) * mix(0.25, 1.0, ATTENUATION);
		vec3 d = mix(shadow_tint, light_tint, lit);
		float r = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0) * rim * lit;
		DIFFUSE_LIGHT += d + vec3(r);
	}
}
