// Painted plate: the static park shows the painting (screen-aligned for the fixed
// camera) instead of its own colors. The low-poly geometry still writes depth, so
// 3D pieces go behind painted trees, and it receives the sun's shadows from them.
shader_type spatial;
render_mode ambient_light_disabled, specular_disabled;

uniform sampler2D plate : source_color, filter_linear, repeat_disable;
uniform float shadow_floor = 0.62;
// Wind: canopies in the sway mask ripple sideways in slow gusts.
uniform sampler2D sway_mask : hint_default_black, filter_linear;
uniform float sway_amount = 0.0035;

void fragment() {
	vec2 uv = SCREEN_UV;
	float m = texture(sway_mask, uv).r;
	float gust = 0.6 + 0.4 * sin(TIME * 0.7 + uv.x * 3.0);
	float wave = sin(TIME * 2.1 + uv.x * 18.0 + uv.y * 26.0) + 0.5 * sin(TIME * 3.3 + uv.y * 41.0);
	uv.x += wave * gust * m * sway_amount;
	uv.y += 0.35 * cos(TIME * 1.7 + uv.x * 23.0) * gust * m * sway_amount;
	ALBEDO = texture(plate, uv).rgb;
	ROUGHNESS = 1.0;
}

void light() {
	if (LIGHT_IS_DIRECTIONAL) {
		DIFFUSE_LIGHT += vec3(mix(shadow_floor, 1.0, ATTENUATION));
	}
}
