// Toon sea: flat colour bands by distance to the coast, moving foam rings,
// a hard foam line at the cliffs and twinkling glints. Receives shadows.
shader_type spatial;
render_mode diffuse_lambert, specular_disabled;

uniform vec3 deep : source_color = vec3(0.13, 0.37, 0.66);
uniform vec3 mid : source_color = vec3(0.18, 0.56, 0.78);
uniform vec3 shallow : source_color = vec3(0.36, 0.80, 0.83);
uniform vec3 foam : source_color = vec3(0.97, 0.98, 1.0);
uniform float island_r = 13.0;
uniform float glint = 1.0;
varying vec3 world;

float coast(float th) {
	return island_r * (1.0 + 0.1 * sin(3.0 * th + 1.3) + 0.06 * sin(7.0 * th + 0.4) + 0.03 * sin(13.0 * th));
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float th = atan(world.z, world.x);
	float d = length(world.xz) - coast(th) * 0.97;
	float wob = sin(th * 23.0 + TIME * 1.3) * 0.08 + sin(th * 9.0 - TIME * 0.7) * 0.1;
	vec3 c = deep;
	c = mix(c, mid, step(d + wob, 6.5));
	c = mix(c, shallow, step(d + wob, 2.2));
	// Foam rings drifting out from the island.
	float ring = fract((d + wob) * 0.45 - TIME * 0.18);
	float ring_mask = step(0.93, ring) * (1.0 - smoothstep(1.5, 6.0, d));
	c = mix(c, mix(c, foam, 0.75), ring_mask);
	// Hard foam at the cliffs.
	c = mix(c, foam, step(d + wob * 1.5, 0.45 + 0.12 * sin(TIME * 1.7 + th * 5.0)));
	// Glints: sparse cells that blink.
	vec2 cell = floor(world.xz * 1.6);
	float h = hash(cell);
	vec2 f = fract(world.xz * 1.6) - 0.5;
	float blink = step(0.965, h) * step(0.6, sin(TIME * 2.0 + h * 40.0));
	float dash = step(abs(f.y), 0.035) * step(abs(f.x), 0.22);
	c = mix(c, foam, blink * dash * glint * step(2.0, d));
	ALBEDO = c;
	ROUGHNESS = 1.0;
}

void light() {
	if (LIGHT_IS_DIRECTIONAL) {
		DIFFUSE_LIGHT += LIGHT_COLOR * mix(0.55, 1.0, smoothstep(0.3, 0.6, ATTENUATION)) / PI;
	}
}
