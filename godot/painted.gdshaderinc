// Shared body of painted.gdshader and painted_crisp.gdshader.

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, hint_default_white;
uniform bool use_vertex_color = false;
uniform float saturation = 1.35;
uniform vec3 light_tint : source_color = vec3(1.0, 0.97, 0.9);
uniform vec3 shadow_tint : source_color = vec3(0.6, 0.55, 0.78);
uniform float rim = 0.22;
uniform sampler2D brush : hint_default_white, repeat_enable;
uniform float brush_amount = 0.18;
// Ink edge drawn into the surface itself (for thin pieces like rails, where an
// outline hull is too coarse): darkens toward the silhouette.
uniform float ink = 0.0;
// Painted crate (tiles): projected onto each face of a box of `crate_size`, used as
// light and dark detail on the piece's own color.
uniform sampler2D crate_texture : source_color, hint_default_white, filter_linear_mipmap;
uniform bool use_crate = false;
uniform vec3 crate_size = vec3(1.0);

varying vec3 world_pos;
varying vec3 obj_pos;
varying vec3 obj_normal;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	obj_pos = VERTEX;
	obj_normal = NORMAL;
}

void fragment() {
	vec3 c = albedo.rgb * texture(albedo_texture, UV).rgb;
	if (use_vertex_color) {
		c *= COLOR.rgb;
	}
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	c = max(mix(vec3(l), c, saturation), 0.0);
	if (use_crate) {
		vec3 an = abs(obj_normal);
		vec3 q = obj_pos / crate_size + 0.5;
		vec2 uv = an.y > 0.5 ? q.xz : (an.x > an.z ? vec2(q.z, 1.0 - q.y) : vec2(q.x, 1.0 - q.y));
		vec3 t = texture(crate_texture, uv).rgb;
		float tl = dot(t, vec3(0.299, 0.587, 0.114));
		c *= mix(vec3(tl), t, 0.35) / 0.55;
	}
	// Brush strokes: a painted dab texture, projected from the top and the front.
	vec3 wn = abs(normalize((MODEL_MATRIX * vec4(obj_normal, 0.0)).xyz));
	float bt = texture(brush, world_pos.xz * 1.3).r;
	float bf = texture(brush, world_pos.xy * 1.3 + 0.37).r;
	float b = mix(bf, bt, smoothstep(0.3, 0.7, wn.y));
	c *= 1.0 + brush_amount * (b - 0.55) * 2.0;
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
