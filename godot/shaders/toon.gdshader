// Cel shading for the whole diorama: two hard light bands, a cool shade tint
// (from the environment's ambient color), a crisp specular blob for glossy
// paint and a thin rim of light. Vertex colors carry the palette.
// Vertex alpha below 1 marks foliage that sways in the wind (1 - alpha = weight).
shader_type spatial;
render_mode diffuse_lambert, specular_disabled;

uniform vec4 albedo : source_color = vec4(1.0);
uniform float gloss = 0.0;
uniform float rim = 0.18;
uniform float emission_strength = 0.0;
uniform float wind = 0.0;
uniform float light_boost = 1.0;

void vertex() {
	if (wind > 0.0) {
		vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
		float weight = (1.0 - COLOR.a) * wind;
		VERTEX.x += sin(TIME * 1.4 + w.x * 0.6 + w.z * 0.4) * weight * 0.05;
		VERTEX.z += cos(TIME * 1.1 + w.z * 0.7) * weight * 0.035;
	}
}

void fragment() {
	// Vertex colours are authored in sRGB.
	vec3 vc = mix(COLOR.rgb / 12.92, pow((COLOR.rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, COLOR.rgb));
	ALBEDO = albedo.rgb * vc;
	ROUGHNESS = 1.0;
	METALLIC = 0.0;
	EMISSION = ALBEDO * emission_strength;
}

void light() {
	float ndl = dot(NORMAL, LIGHT);
	if (LIGHT_IS_DIRECTIONAL) {
		float shadow = smoothstep(0.3, 0.6, ATTENUATION);
		float lit = smoothstep(0.0, 0.06, ndl) * shadow;
		// A soft second band so big curved shapes still read as round.
		float band = mix(0.82, 1.0, smoothstep(0.42, 0.5, ndl));
		DIFFUSE_LIGHT += LIGHT_COLOR * lit * band * light_boost / PI;
		vec3 h = normalize(LIGHT + VIEW);
		float spec = smoothstep(0.955, 0.965, dot(NORMAL, h)) * gloss * lit;
		float fres = smoothstep(0.62, 0.68, 1.0 - max(dot(NORMAL, VIEW), 0.0));
		SPECULAR_LIGHT += LIGHT_COLOR * (spec * 0.35 + fres * rim * 0.12 * (0.35 + 0.65 * lit)) / PI;
	} else {
		float a = clamp(ATTENUATION * max(ndl, 0.0), 0.0, 1.0);
		DIFFUSE_LIGHT += LIGHT_COLOR * (floor(a * 3.0 + 0.5) / 3.0) / PI;
	}
}
