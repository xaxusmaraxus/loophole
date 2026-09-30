extends Node3D
## Loophole style test, "inked toy diorama" pass. Everything is generated in code:
## a terraced island, toon sea, the puzzle plot, a steel coaster with teardrop
## loops, a heartline roll and a helix, a five-car train, chibi guests (some of
## them already green), and a skyline of rides. The look comes from three
## shaders: toon.gdshader (cel light), ink_post.gdshader (line art + grading)
## and water.gdshader.
##
## Run normally to play with it, or with `-- --shots` to render the comparison
## shots into res://shots/ and quit.
## Keys: arrows swipe the tiles, C cycles cameras, T toggles day/sunset.

const Geo = preload("res://geo.gd")
const TOON = preload("res://shaders/toon.gdshader")
const INK = preload("res://shaders/ink_post.gdshader")
const WATER = preload("res://shaders/water.gdshader")

const TIER_COLORS := [
	Color("#c9c3b5"), Color("#f0b865"), Color("#7fcf5c"), Color("#4fb0e8"),
	Color("#a07cf0"), Color("#f2564b"), Color("#ff9a3d"), Color("#ffd23f"),
]
const PLOT_N := 5
const ISLAND_R := 13.0
const WATER_Y := -2.8
const PLOT_TOP := 0.21
const STATION_Y := 0.44

const RAIL := Color("#e8413a")
const SPINE := Color("#fff4e0")
const STEEL := Color("#2d9aa8")
const INK_COL := Color("#2b1d3c")
const CREAM := Color("#fff4e0")
const GOLD := Color("#ffc93c")
const NAVY := Color("#34305a")
const STRIPE_RED := Color("#ec4a4f")

const SKINS := [Color("#ffdcc2"), Color("#f2bf98"), Color("#d6976b"), Color("#a06a45"), Color("#6e4630")]
const SHIRTS := [Color("#f0584e"), Color("#45a8e0"), Color("#72c457"), Color("#ffd23f"), Color("#9d6ef0"), Color("#ff9a3c"), Color("#ff8fb8"), Color("#35c2b0"), Color("#ffffff")]
const PANTS := [Color("#3b4a80"), Color("#4a3a5e"), Color("#6a7a9a"), Color("#e8d8b8"), Color("#2e2e44")]
const HAIRS := [Color("#3a2718"), Color("#6b4428"), Color("#c0682e"), Color("#f0c85a"), Color("#e8e8f0"), Color("#232338"), Color("#e8607a")]
const SICK := Color("#a6d66a")
const PUKE := Color("#bddc3c")
const AUTUMN := [Color("#f08a34"), Color("#e2552f"), Color("#f7b93c"), Color("#c9432e"), Color("#ff9f45")]
const EVERGREEN := [Color("#3f9a52"), Color("#4fae57"), Color("#2f7f4d"), Color("#5cb85a")]

var rng := RandomNumberGenerator.new()
var noise := FastNoiseLite.new()
var patch := FastNoiseLite.new()
var env: Environment
var sun: DirectionalLight3D
var sky_mat: ProceduralSkyMaterial
var cam: Camera3D
var ink_mat: ShaderMaterial
var lamps: Array[OmniLight3D] = []
var sunset := false
var cam_mode := 0
var shooting := false

var m_matte: ShaderMaterial
var m_gloss: ShaderMaterial
var m_leaf: ShaderMaterial
var m_glow: ShaderMaterial
var m_far: ShaderMaterial
var g_matte: Geo
var g_gloss: Geo
var g_leaf: Geo
var g_glow: Geo

var track_path: Path3D
var track_curve: Curve3D
var track_samples: Array[Vector3] = []
var cars: Array[Node3D] = []
var train_progress := 0.0
var train_speed := 1.6
var marks := {}

var wheel: Node3D
var gondolas: Array[Node3D] = []
var wheel_hub := Vector3.ZERO
var carousel: Node3D

## Puzzle plot: tier per cell (0 = empty), and which cells hold track.
var grid: Array = []
var tile_nodes := {}
var track_cells := {}
var tiles_root: Node3D
var tile_meshes := {}


func _ready() -> void:
	rng.seed = 11
	noise.seed = 5
	noise.frequency = 0.08
	patch.seed = 9
	patch.frequency = 0.05
	patch.fractal_octaves = 2
	_make_materials()
	g_matte = Geo.new()
	g_gloss = Geo.new()
	g_leaf = Geo.new()
	g_glow = Geo.new()
	_build_environment()
	_build_island()
	_build_water()
	_build_waterfall()
	_build_backdrop()
	_build_plaza()
	_build_plot()
	_build_coaster()
	_build_station()
	_build_trees()
	_build_rides()
	_build_dressing()
	_build_guests()
	flush(g_matte, m_matte)
	flush(g_gloss, m_gloss)
	flush(g_leaf, m_leaf)
	flush(g_glow, m_glow)
	cam = Camera3D.new()
	cam.far = 400.0
	add_child(cam)
	_build_ink()
	_set_time(false)
	_set_camera(1)
	if "--shots" in OS.get_cmdline_user_args():
		shooting = true
		_render_shots()


# ---- Materials and helpers ---------------------------------------------------

func toon(params := {}) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = TOON
	for k in params:
		m.set_shader_parameter(k, params[k])
	return m


func _make_materials() -> void:
	m_matte = toon({"rim": 0.25})
	m_gloss = toon({"gloss": 1.0, "rim": 0.45})
	m_leaf = toon({"rim": 0.35, "wind": 1.0})
	m_glow = toon({"emission_strength": 0.4})
	m_far = toon({"rim": 0.0, "light_boost": 0.8})


func flush(g: Geo, m: Material, parent: Node3D = null, pos := Vector3.ZERO) -> MeshInstance3D:
	if g.count == 0:
		return null
	var mi := MeshInstance3D.new()
	mi.mesh = g.commit()
	mi.material_override = m
	mi.position = pos
	(parent if parent else self).add_child(mi)
	return mi


func at(pos: Vector3, basis := Basis()) -> Transform3D:
	return Transform3D(basis, pos)


func yaw_basis(yaw: float) -> Basis:
	return Basis(Vector3.UP, yaw)


func cell_pos(c: Vector2i) -> Vector3:
	return Vector3(c.x - 2, PLOT_TOP, c.y - 2)


func jitter(c: Color, amount := 0.04) -> Color:
	return Color(
		clampf(c.r + rng.randf_range(-amount, amount), 0.0, 1.0),
		clampf(c.g + rng.randf_range(-amount, amount), 0.0, 1.0),
		clampf(c.b + rng.randf_range(-amount, amount), 0.0, 1.0), c.a)


func pick(list: Array) -> Variant:
	return list[rng.randi() % list.size()]


## A tube along `pts` with parallel-transported frames (no twisting).
func tube_along(g: Geo, pts: Array, r: float, col: Color, sides := 6, closed := false) -> void:
	var n := pts.size()
	var rights := []
	var ups := []
	var up := Vector3.ZERO
	for i in n:
		var a: Vector3 = pts[(i - 1 + n) % n] if closed else pts[maxi(i - 1, 0)]
		var b: Vector3 = pts[(i + 1) % n] if closed else pts[mini(i + 1, n - 1)]
		var t := (b - a).normalized()
		if i == 0:
			up = Vector3.UP if absf(t.dot(Vector3.UP)) < 0.9 else Vector3.RIGHT
		up = (up - t * up.dot(t)).normalized()
		rights.append(t.cross(up).normalized())
		ups.append(up)
	var c := pts.duplicate()
	if closed:
		c.append(pts[0])
		rights.append(rights[0])
		ups.append(ups[0])
	g.tube(c, rights, ups, r, col, sides)


## A string of pennants hanging between a and b.
func bunting(a: Vector3, b: Vector3, sag := 0.25, flags := 9) -> void:
	var cols := [STRIPE_RED, GOLD, Color("#45a8e0"), CREAM, Color("#72c457")]
	var pts := []
	for k in flags * 2 + 1:
		var t := float(k) / (flags * 2)
		pts.append(a.lerp(b, t) - Vector3(0, sag * 4.0 * t * (1.0 - t), 0))
	tube_along(g_matte, pts, 0.008, NAVY, 4)
	var side := (b - a).cross(Vector3.UP).normalized()
	for k in flags:
		var p0: Vector3 = pts[k * 2]
		var p1: Vector3 = pts[k * 2 + 2]
		var tip: Vector3 = (p0 + p1) / 2.0 - Vector3(0, 0.16, 0)
		var col: Color = cols[k % cols.size()]
		g_matte.tri(p0, p1, tip, col, (p0 + p1 + tip) / 3.0 - side)
		g_matte.tri(p0, p1, tip, col, (p0 + p1 + tip) / 3.0 + side)


# ---- Environment -------------------------------------------------------------

func _build_environment() -> void:
	var we := WorldEnvironment.new()
	env = Environment.new()
	sky_mat = ProceduralSkyMaterial.new()
	sky_mat.sun_angle_max = 8.0
	sky_mat.sky_curve = 0.12
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.tonemap_white = 3.0
	env.ssao_enabled = true
	env.ssao_radius = 0.5
	env.ssao_intensity = 1.4
	env.ssao_light_affect = 0.2
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_hdr_threshold = 1.0
	env.glow_bloom = 0.0
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.fog_enabled = true
	env.fog_sky_affect = 0.0
	if "fog_mode" in env:
		env.set("fog_mode", 1)
		env.set("fog_depth_begin", 55.0)
		env.set("fog_depth_end", 130.0)
		env.fog_density = 0.75
	else:
		env.fog_density = 0.0015
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.04
	env.adjustment_contrast = 1.04
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 80.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.shadow_blur = 0.6
	sun.shadow_bias = 0.03
	sun.shadow_normal_bias = 1.2
	add_child(sun)


func _set_time(evening: bool) -> void:
	sunset = evening
	if evening:
		sun.rotation_degrees = Vector3(-20, 62, 0)
		sun.light_color = Color(1.0, 0.72, 0.48)
		sun.light_energy = 1.25
		sky_mat.sky_top_color = Color("#3b3f86")
		sky_mat.sky_horizon_color = Color("#ff9e6e")
		sky_mat.ground_horizon_color = Color("#f08a70")
		sky_mat.ground_bottom_color = Color("#2d2c62")
		sky_mat.sun_angle_max = 12.0
		env.ambient_light_color = Color("#7a6ab8")
		env.ambient_light_energy = 0.62
		env.fog_light_color = Color("#e59a8c")
		m_glow.set_shader_parameter("emission_strength", 2.6)
		ink_mat.set_shader_parameter("warm", Color(1.0, 0.93, 0.84)) if ink_mat else null
		ink_mat.set_shader_parameter("cool", Color(0.8, 0.8, 1.0)) if ink_mat else null
	else:
		sun.rotation_degrees = Vector3(-50, 32, 0)
		sun.light_color = Color(1.0, 0.96, 0.88)
		sun.light_energy = 1.2
		sky_mat.sky_top_color = Color("#3f7fd0")
		sky_mat.sky_horizon_color = Color("#c4e6f5")
		sky_mat.ground_horizon_color = Color("#a8d6e8")
		sky_mat.ground_bottom_color = Color("#3b6d8f")
		sky_mat.sun_angle_max = 8.0
		env.ambient_light_color = Color("#9aa4e0")
		env.ambient_light_energy = 0.58
		env.fog_light_color = Color("#bcdcf0")
		m_glow.set_shader_parameter("emission_strength", 0.35)
		ink_mat.set_shader_parameter("warm", Color(1.0, 0.97, 0.92)) if ink_mat else null
		ink_mat.set_shader_parameter("cool", Color(0.88, 0.9, 1.0)) if ink_mat else null
	for l in lamps:
		l.light_energy = 0.7 if evening else 0.0


func _build_ink() -> void:
	ink_mat = ShaderMaterial.new()
	ink_mat.shader = INK
	ink_mat.render_priority = 127
	ink_mat.set_shader_parameter("ink", INK_COL)
	var q := QuadMesh.new()
	q.size = Vector2(2, 2)
	var mi := MeshInstance3D.new()
	mi.mesh = q
	mi.material_override = ink_mat
	mi.extra_cull_margin = 16384.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = Vector3(0, 0, -1.0)
	cam.add_child(mi)
	mi.visible = not ("--noink" in OS.get_cmdline_user_args())
	if "--inkdebug" in OS.get_cmdline_user_args():
		ink_mat.set_shader_parameter("debug", 1)


# ---- Island ------------------------------------------------------------------

func island_radius(theta: float) -> float:
	return ISLAND_R * (1.0 + 0.1 * sin(3.0 * theta + 1.3) + 0.06 * sin(7.0 * theta + 0.4) + 0.03 * sin(13.0 * theta))


func island_height(p: Vector2) -> float:
	var d := p.length()
	if d < 7.6:
		return 0.0
	var t := smoothstep(7.6, 10.5, d)
	return (0.35 + noise.get_noise_2d(p.x * 2.0, p.y * 2.0) * 0.55) * t


func grass_color(p: Vector2) -> Color:
	var n := patch.get_noise_2d(p.x, p.y)
	var c := Color("#6db54c")
	if n < -0.18:
		c = Color("#5a9f45")
	elif n > 0.22:
		c = Color("#84c457")
	elif n > 0.08:
		c = Color("#77bc51")
	return c


func _build_island() -> void:
	var g := g_matte
	var rings := 26
	var segs := 128
	var top := func(k: int, m: int) -> Vector3:
		var th := TAU * m / segs
		var r := island_radius(th) * k / rings
		var p := Vector2(cos(th), sin(th)) * r
		return Vector3(p.x, island_height(p), p.y)
	for k in rings:
		for m in segs:
			var a: Vector3 = top.call(k, m)
			var b: Vector3 = top.call(k + 1, m)
			var c: Vector3 = top.call(k + 1, m + 1)
			var d: Vector3 = top.call(k, m + 1)
			var mid := (a + b + c + d) / 4.0
			var col := grass_color(Vector2(mid.x, mid.z))
			g.quad(a, b, c, d, col, mid - Vector3.UP)
	# Overhanging grass lip, then terraced rock strata down into the sea.
	var strata := [Color("#c98f5c"), Color("#a86f4a"), Color("#d8a36a"), Color("#8f5f45"), Color("#b77e55"), Color("#7a5048")]
	var fracs := [0.0, 0.13, 0.3, 0.44, 0.62, 0.8, 1.0]
	for m in segs:
		var ths := [TAU * m / segs, TAU * (m + 1) / segs]
		var dirs := []
		var edge_r := []
		var top_y := []
		for th in ths:
			dirs.append(Vector3(cos(th), 0, sin(th)))
			edge_r.append(island_radius(th))
			top_y.append(island_height(Vector2(cos(th), sin(th)) * island_radius(th)))
		# Lip: a grass band with drips.
		var lip := []
		for i in 2:
			var drip := 0.22 + 0.12 * maxf(0.0, sin(ths[i] * 37.0)) + 0.06 * maxf(0.0, sin(ths[i] * 91.0 + 1.0))
			lip.append(top_y[i] - drip)
		var lip_col := Color("#5aa043")
		var o0: Vector3 = dirs[0] * edge_r[0]
		var o1: Vector3 = dirs[1] * edge_r[1]
		g.quad(o0 + Vector3(0, top_y[0], 0), o1 + Vector3(0, top_y[1], 0), o1 + Vector3(0, lip[1], 0), o0 + Vector3(0, lip[0], 0), lip_col, Vector3(0, top_y[0], 0))
		# Underside of the lip.
		var r_prev := [edge_r[0] * 0.972, edge_r[1] * 0.972]
		var y_prev := [top_y[0] - 0.26, top_y[1] - 0.26]
		g.quad(o0 + Vector3(0, lip[0], 0), o1 + Vector3(0, lip[1], 0), dirs[1] * r_prev[1] + Vector3(0, y_prev[1], 0), dirs[0] * r_prev[0] + Vector3(0, y_prev[0], 0), Color("#4b3a3a"), (o0 + o1) / 2.0 * 0.9 + Vector3(0, lip[0] + 1.0, 0))
		for j in fracs.size() - 1:
			var y_next := []
			var r_next := []
			for i in 2:
				var n := noise.get_noise_2d(ths[i] * 30.0, j * 7.0)
				var f: float = fracs[j + 1] + (0.03 * n if j + 1 < fracs.size() - 1 else 0.0)
				y_next.append(lerpf(top_y[i] - 0.26, WATER_Y - 0.8, f))
				r_next.append(edge_r[i] * (0.972 - 0.016 * j + 0.012 * n))
			var col: Color = strata[j % strata.size()]
			if noise.get_noise_2d(m * 0.9, j * 3.0) > 0.25:
				col = col.darkened(0.1)
			# Wall of this band.
			var w0: Vector3 = dirs[0] * r_prev[0]
			var w1: Vector3 = dirs[1] * r_prev[1]
			g.quad(w0 + Vector3(0, y_prev[0], 0), w1 + Vector3(0, y_prev[1], 0), w1 + Vector3(0, y_next[1], 0), w0 + Vector3(0, y_next[0], 0), col, Vector3(0, (y_prev[0] + y_next[0]) / 2.0, 0))
			# Ledge where the next band steps in: catches light, sometimes mossy.
			if j < fracs.size() - 2:
				var l0: Vector3 = dirs[0] * r_next[0]
				var l1: Vector3 = dirs[1] * r_next[1]
				var ledge := col.lightened(0.18)
				if noise.get_noise_2d(m * 0.7 + 40.0, j * 5.0) > 0.1:
					ledge = Color("#6aad4a")
				var cen := (w0 + w1 + l0 + l1) / 4.0 + Vector3(0, y_next[0], 0)
				g.quad(w0 + Vector3(0, y_next[0], 0), w1 + Vector3(0, y_next[1], 0), l1 + Vector3(0, y_next[1], 0), l0 + Vector3(0, y_next[0], 0), ledge, cen - Vector3.UP)
			r_prev = r_next
			y_prev = y_next
	# Rocks tumbled at the waterline.
	for i in 38:
		var th := rng.randf() * TAU
		var r := island_radius(th) * rng.randf_range(0.9, 0.97)
		g.blob(Vector3(cos(th) * r, WATER_Y + rng.randf_range(-0.1, 0.2), sin(th) * r), rng.randf_range(0.25, 0.6), jitter(Color("#8f7a70"), 0.05), rng.randi(), 0.25, Vector3(1.0, 0.7, 1.0))
	# Grass tufts and flowers.
	var placed := 0
	while placed < 700:
		var th := rng.randf() * TAU
		var r := rng.randf_range(7.3, island_radius(th) - 0.25)
		var p := Vector2(cos(th), sin(th)) * r
		if _on_path(th, r):
			continue
		var base := Vector3(p.x, island_height(p), p.y)
		var col := grass_color(p).darkened(0.12)
		col.a = 0.3
		for b in 3:
			var ang := rng.randf() * TAU
			var o := Vector3(cos(ang), 0, sin(ang)) * 0.05
			var tip := base + o * 1.6 + Vector3(0, rng.randf_range(0.12, 0.2), 0)
			var side := Vector3(-o.z, 0, o.x).normalized() * 0.025
			g_leaf.tri(base + o - side, base + o + side, tip, col, base + o - Vector3(1, 0, 1))
		placed += 1
	var flower_cols := [Color("#ff5d8a"), Color("#ffd23f"), Color("#ffffff"), Color("#b58cff"), Color("#ff8a3c")]
	for i in 420:
		var th := rng.randf() * TAU
		var r := rng.randf_range(7.4, island_radius(th) - 0.3)
		var p := Vector2(cos(th), sin(th)) * r
		if _on_path(th, r):
			continue
		var fc: Color = flower_cols[int(absf(patch.get_noise_2d(p.x * 3.0, p.y * 3.0)) * 17.0) % flower_cols.size()]
		g_matte.blob(Vector3(p.x, island_height(p) + 0.05, p.y), 0.045, fc, rng.randi(), 0.2)


func _on_path(th: float, r: float) -> bool:
	for pth in [0.4, 2.3, 4.1]:
		if absf(wrapf(th - pth, -PI, PI)) * r < 0.9:
			return true
	return false


func _build_water() -> void:
	var sm := ShaderMaterial.new()
	sm.shader = WATER
	var plane := PlaneMesh.new()
	plane.size = Vector2(260, 260)
	plane.subdivide_width = 8
	plane.subdivide_depth = 8
	var mi := MeshInstance3D.new()
	mi.mesh = plane
	mi.material_override = sm
	# Off-centre and turned, so no triangle seam lines up with the camera axis.
	mi.position = Vector3(23.0, WATER_Y, -17.0)
	mi.rotation.y = 0.37
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


func _build_waterfall() -> void:
	var th := 1.05
	var r := island_radius(th)
	var dir := Vector3(cos(th), 0, sin(th))
	var side := dir.cross(Vector3.UP)
	var water := Color("#6fd2f2")
	# A pond feeding a stream to the edge.
	var pond := dir * (r - 3.3)
	var py := island_height(Vector2(pond.x, pond.z))
	g_matte.cyl(at(pond + Vector3(0, py + 0.02, 0)), 0.95, 0.95, 0.06, water, 14, Color("#79d8f5"))
	for k in 10:
		var a := TAU * k / 10.0
		g_matte.blob(pond + Vector3(cos(a) * 1.0, py + 0.05, sin(a) * 1.0), rng.randf_range(0.12, 0.2), jitter(Color("#b8aca0"), 0.05), rng.randi())
	for k in 8:
		var p := dir * (r - 2.4 + k * 0.33)
		var h := island_height(Vector2(p.x, p.z))
		g_matte.box(at(p + Vector3(0, h + 0.03, 0), Basis(Vector3.UP, -th)), Vector3(0.36, 0.05, 0.5), water)
	# The fall: a sheet of animated streaks down the cliff.
	var top_y := island_height(Vector2(dir.x, dir.z) * r)
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode unshaded, cull_disabled;
void fragment() {
	float streak = fract(UV.y * 2.5 - TIME * 1.4 + sin(UV.x * 31.0) * 0.2);
	vec3 c = mix(vec3(0.42, 0.80, 0.95), vec3(0.95, 0.99, 1.0), step(0.72, streak));
	c = mix(c, vec3(1.0), smoothstep(0.85, 1.0, UV.y));
	ALBEDO = c;
}
"""
	var sm := ShaderMaterial.new()
	sm.shader = sh
	var q := QuadMesh.new()
	q.size = Vector2(0.5, top_y - WATER_Y + 0.1)
	var fall := MeshInstance3D.new()
	fall.mesh = q
	fall.material_override = sm
	fall.position = dir * (r + 0.12) + Vector3(0, (top_y + WATER_Y) / 2.0, 0)
	add_child(fall)
	fall.look_at(fall.position + dir, Vector3.UP)
	# Splash and mist at the bottom.
	for k in 9:
		g_matte.blob(dir * (r + 0.35) + side * rng.randf_range(-0.45, 0.45) + Vector3(0, WATER_Y + 0.05, 0), rng.randf_range(0.14, 0.26), Color("#ffffff"), rng.randi(), 0.2, Vector3(1.0, 0.6, 1.0))


func _build_backdrop() -> void:
	# Distant peaks with snow caps, softened by fog.
	var g := Geo.new()
	for i in 24:
		var th := rng.randf_range(-3.3, 0.6)
		var d := rng.randf_range(55.0, 85.0)
		var h := rng.randf_range(12.0, 28.0)
		var pos := Vector3(cos(th) * d, WATER_Y - 1.0, sin(th) * d)
		var c := jitter(Color("#7d8fc4"), 0.05)
		var basis := Basis(Vector3.UP, rng.randf() * TAU)
		g.cyl(at(pos + Vector3(0, h / 2.0, 0), basis), h * 0.7, 0.0, h, c, 6)
		if h > 17.0:
			g.cyl(at(pos + Vector3(0, h * 0.85, 0), basis), h * 0.7 * 0.3 + 0.2, 0.0, h * 0.3, Color("#f4f6ff"), 6)
	flush(g, m_far)
	# Clouds: puffy clusters behind the island.
	for i in 12:
		var th := rng.randf_range(-3.5, -0.2)
		var d := rng.randf_range(24.0, 42.0)
		var c := Vector3(cos(th) * d, rng.randf_range(4.0, 9.0), sin(th) * d)
		var s := rng.randf_range(1.2, 2.4)
		for k in 6:
			var o := Vector3(rng.randf_range(-1.6, 1.6), rng.randf_range(0.0, 0.5), rng.randf_range(-0.6, 0.6)) * s
			g_matte.sphere(c + o, rng.randf_range(0.6, 1.0) * s, Color("#fffaf6"), Vector3(1.2, 0.75, 1.0), 10, 6, true)
	# Small islets with trees.
	for p in [Vector3(-21, WATER_Y, 9), Vector3(19, WATER_Y, -15), Vector3(-12, WATER_Y, -24)]:
		g_matte.cyl(at(p + Vector3(0, 0.6, 0)), 2.6, 2.1, 1.6, Color("#b77e55"), 10, Color("#72c457"))
		for k in 4:
			_tree(p + Vector3(rng.randf_range(-1.3, 1.3), 1.4, rng.randf_range(-1.3, 1.3)))


# ---- Park --------------------------------------------------------------------

func _in_plot_area(p: Vector3) -> bool:
	return absf(p.x) < 2.95 and p.z > -2.95 and p.z < 4.9 and (p.z < 2.95 or absf(p.x - 0.0) < 2.3)


func _build_plaza() -> void:
	# Grout disk, then rings of pavers with a rose-stone pattern.
	g_matte.cyl(at(Vector3(0, 0.0, 0)), 7.3, 7.3, 0.08, Color("#b9a07c"), 64, Color("#cfb68e"))
	var pav := [Color("#ecd9b0"), Color("#e4cfa2"), Color("#f2e2bd")]
	var rose := Color("#e8b9a0")
	var r := 0.4
	var ring := 0
	while r < 7.0:
		var n := maxi(6, int(TAU * r / 0.62))
		for k in n:
			var a0 := TAU * (k + 0.06) / n
			var a1 := TAU * (k + 0.94) / n
			var r0 := r + 0.04
			var r1 := r + 0.46
			var cen := Vector3(cos((a0 + a1) / 2.0), 0, sin((a0 + a1) / 2.0)) * (r0 + r1) / 2.0
			if _in_plot_area(cen):
				continue
			var col: Color = jitter(pav[rng.randi() % pav.size()], 0.015)
			if ring % 4 == 3 or (ring % 4 == 1 and k % 3 == 0):
				col = jitter(rose, 0.015)
			var y := 0.045
			g_matte.quad(Vector3(cos(a0) * r0, y, sin(a0) * r0), Vector3(cos(a1) * r0, y, sin(a1) * r0),
				Vector3(cos(a1) * r1, y, sin(a1) * r1), Vector3(cos(a0) * r1, y, sin(a0) * r1), col, cen)
		r += 0.5
		ring += 1
	# Stone kerb around the plaza.
	for k in 72:
		var a := TAU * (k + 0.5) / 72.0
		if _on_path(a, 7.4):
			continue
		g_matte.box(at(Vector3(cos(a) * 7.35, 0.05, sin(a) * 7.35), Basis(Vector3.UP, -a)), Vector3(0.18, 0.12, 0.62), Color("#d8c7a4"), 0.03)
	# Paths out to the island edge.
	for th in [0.4, 2.3, 4.1]:
		var dir := Vector3(cos(th), 0, sin(th))
		var side := dir.cross(Vector3.UP)
		var s := 7.2
		while s < island_radius(th) - 0.35:
			for w in [-0.32, 0.32]:
				var p: Vector3 = dir * s + side * w
				var h: float = island_height(Vector2(p.x, p.z))
				g_matte.box(at(p + Vector3(0, h + 0.02, 0), Basis(Vector3.UP, -th)), Vector3(0.44, 0.07, 0.6), jitter(pav[rng.randi() % 3], 0.02), 0.02)
			s += 0.5


func _build_plot() -> void:
	# Raised plinth with a bevel and a trim band.
	g_matte.box(at(Vector3(0, 0.04, 0.0)), Vector3(5.9, 0.1, 5.9), Color("#9a8a86"), 0.04)
	g_matte.box(at(Vector3(0, 0.1, 0.0)), Vector3(5.6, 0.2, 5.6), Color("#d9c8a8"), 0.06)
	for c in TRACK:
		track_cells[c[0]] = c[1]
	for y in PLOT_N:
		for x in PLOT_N:
			var v := Vector2i(x, y)
			var col := Color("#8fd46a") if (x + y) % 2 == 0 else Color("#80c65d")
			if track_cells.has(v):
				col = Color("#e3d3ae") if (x + y) % 2 == 0 else Color("#d8c7a0")
			g_matte.box(at(cell_pos(v) - Vector3(0, 0.02, 0)), Vector3(0.96, 0.05, 0.96), col, 0.015)
	tiles_root = Node3D.new()
	add_child(tiles_root)
	grid = []
	for y in PLOT_N:
		var row := []
		for x in PLOT_N:
			row.append(0)
		grid.append(row)
	var weights := [0, 5, 4, 3, 2, 1, 1, 1]
	for y in PLOT_N:
		for x in PLOT_N:
			var v := Vector2i(x, y)
			if track_cells.has(v) or rng.randf() < 0.25:
				continue
			grid[y][x] = _weighted(weights)
	_sync_tiles(true)


func _weighted(weights: Array) -> int:
	var total := 0
	for w in weights:
		total += w
	var roll := rng.randi_range(1, total)
	for i in weights.size():
		roll -= weights[i]
		if roll <= 0:
			return i
	return 1


## Tile meshes: a glossy beveled crate in the tier colour with a sculpted icon.
func _tile_mesh(tier: int) -> Array:
	if tile_meshes.has(tier):
		return tile_meshes[tier]
	var body := Geo.new()
	var icon := Geo.new()
	var col: Color = TIER_COLORS[tier]
	body.box(at(Vector3(0, 0.1, 0)), Vector3(0.84, 0.2, 0.84), col, 0.05)
	body.box(at(Vector3(0, 0.205, 0)), Vector3(0.66, 0.03, 0.66), col.lightened(0.22), 0.012)
	var ic := col.lightened(0.62) if tier != 7 else Color("#fff8dc")
	var y0 := 0.22
	match tier:
		1:
			icon.sphere(Vector3(0, y0, 0), 0.17, ic, Vector3(1.3, 0.5, 0.9), 12, 6, true)
		2:
			icon.sphere(Vector3(0, y0, 0), 0.2, ic, Vector3(1.05, 1.05, 0.8), 12, 7, true)
		3:
			var pts := [Vector3(-0.22, y0, 0), Vector3(-0.22, y0 + 0.34, 0), Vector3(-0.12, y0 + 0.34, 0), Vector3(0.24, y0, 0)]
			var z := Vector3(0, 0, 0.11)
			var cen := Vector3(-0.08, y0 + 0.12, 0)
			icon.quad(pts[0] - z, pts[1] - z, pts[2] - z, pts[3] - z, ic, cen)
			icon.quad(pts[0] + z, pts[1] + z, pts[2] + z, pts[3] + z, ic, cen)
			for i in 4:
				var a: Vector3 = pts[i]
				var b: Vector3 = pts[(i + 1) % 4]
				icon.quad(a - z, b - z, b + z, a + z, ic.darkened(0.05), cen)
		4:
			var h := []
			for k in 33:
				var a := TAU * 2.0 * k / 32.0
				h.append(Vector3(cos(a) * 0.15, y0 + 0.05 + 0.26 * k / 32.0, sin(a) * 0.15))
			tube_along(icon, h, 0.035, ic, 6)
		5, 7:
			var s := 1.0 if tier == 5 else 1.3
			var ring := []
			for k in 24:
				var a := TAU * k / 24.0
				ring.append(Vector3(sin(a) * 0.16 * s, y0 + 0.19 * s - cos(a) * 0.16 * s, 0))
			tube_along(icon, ring, 0.04 * s, ic, 8, true)
			if tier == 7:
				var star_c := Vector3(0, y0 + 0.19 * s, 0)
				var pts := []
				for k in 10:
					var a := TAU * k / 10.0 - PI / 2.0
					var rr := 0.12 if k % 2 == 0 else 0.05
					pts.append(star_c + Vector3(cos(a) * rr, -sin(a) * rr, 0))
				for k in 10:
					var a: Vector3 = pts[k]
					var b: Vector3 = pts[(k + 1) % 10]
					icon.tri(star_c + Vector3(0, 0, 0.03), a, b, Color("#ffcf2e"), star_c - Vector3(0, 0, 1))
					icon.tri(star_c - Vector3(0, 0, 0.03), a, b, Color("#ffcf2e"), star_c + Vector3(0, 0, 1))
		6:
			var h := []
			for k in 29:
				var t := k / 28.0
				var a := TAU * 1.5 * t
				h.append(Vector3(-0.24 + 0.48 * t, y0 + 0.2 + sin(a) * 0.12, cos(a) * 0.12))
			tube_along(icon, h, 0.035, ic, 6)
	tile_meshes[tier] = [body.commit(), icon.commit()]
	return tile_meshes[tier]


func _tile(tier: int) -> Node3D:
	var n := Node3D.new()
	var meshes := _tile_mesh(tier)
	for i in 2:
		var mi := MeshInstance3D.new()
		mi.mesh = meshes[i]
		mi.material_override = m_gloss
		n.add_child(mi)
	return n


## Rebuilds tile nodes from the grid (instantly, or sliding from their old cells).
func _sync_tiles(instant := false, moves := {}) -> void:
	var old := tile_nodes.duplicate()
	tile_nodes.clear()
	for y in PLOT_N:
		for x in PLOT_N:
			var tier: int = grid[y][x]
			if tier == 0:
				continue
			var v := Vector2i(x, y)
			var node := _tile(tier)
			tiles_root.add_child(node)
			var target := cell_pos(v)
			node.position = target
			if not instant and moves.has(v):
				node.position = cell_pos(moves[v])
				var tw := create_tween()
				tw.tween_property(node, "position", target, 0.12).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
			tile_nodes[v] = node
	for n in old.values():
		n.queue_free()


## A plain 2048 slide for the feel test (track cells are walls, no chains).
func _swipe(dir: Vector2i) -> void:
	var moves := {}
	var moved := false
	for lane in PLOT_N:
		var line: Array[Vector2i] = []
		for k in PLOT_N:
			var s := PLOT_N - 1 - k if (dir.x > 0 or dir.y > 0) else k
			line.append(Vector2i(s, lane) if dir.x != 0 else Vector2i(lane, s))
		var dest := 0
		var last := -1
		var merged := false
		for i in PLOT_N:
			var p := line[i]
			if track_cells.has(p):
				dest = i + 1
				last = -1
				continue
			var t: int = grid[p.y][p.x]
			if t == 0:
				continue
			grid[p.y][p.x] = 0
			if last >= 0 and not merged and grid[line[last].y][line[last].x] == t and t < 7:
				grid[line[last].y][line[last].x] = t + 1
				moves[line[last]] = p
				merged = true
				moved = true
			else:
				var q := line[dest]
				grid[q.y][q.x] = t
				moves[q] = p
				if q != p:
					moved = true
				last = dest
				merged = false
				dest += 1
	if moved:
		_sync_tiles(false, moves)


# ---- Coaster -----------------------------------------------------------------

## The ride as built on the plot: cell and piece tier (0 Flat, 1 Bump, 2 Hill,
## 3 Drop, 4 Helix, 5 Loop, 6 Corkscrew, 7 Mega Loop), from the platform's left
## cell up the left column, across the top, down the right and back in.
const TRACK := [
	[Vector2i(1, 4), 1], [Vector2i(1, 3), 2], [Vector2i(1, 2), 3], [Vector2i(1, 1), 5],
	[Vector2i(1, 0), 4], [Vector2i(2, 0), 2], [Vector2i(3, 0), 6], [Vector2i(4, 0), 0],
	[Vector2i(4, 1), 7], [Vector2i(4, 2), 2], [Vector2i(4, 3), 1], [Vector2i(3, 3), 3],
	[Vector2i(2, 3), 2], [Vector2i(2, 4), 0],
]
## Deck height of the track above the plot, per tier.
const DECK := [0.3, 0.5, 1.15, 1.95, 0.75, 0.32, 0.9, 0.32]


func _build_coaster() -> void:
	var pts: Array[Vector3] = []
	var tilts: Array[float] = []
	var roll := 0.0
	var st_l := cell_pos(Vector2i(1, 5))
	var st_r := cell_pos(Vector2i(2, 5))
	var st_m := (st_l + st_r) / 2.0
	var add := func(p: Vector3, tilt: float) -> void:
		pts.append(p)
		tilts.append(tilt + roll)
	add.call(Vector3(st_l.x, STATION_Y, st_l.z), 0.0)
	var cells: Array = [Vector2i(1, 5)]
	for c in TRACK:
		cells.append(c[0])
	cells.append(Vector2i(2, 5))
	for i in TRACK.size():
		var c: Vector2i = TRACK[i][0]
		var tier: int = TRACK[i][1]
		var d_in: Vector2i = c - cells[i]
		var d_out: Vector2i = cells[i + 2] - c
		var fwd := Vector3(d_in.x, 0, d_in.y)
		var fwd_out := Vector3(d_out.x, 0, d_out.y)
		var right := fwd.cross(Vector3.UP)
		var turn := fwd.cross(fwd_out).y
		var bank := 0.0 if absf(turn) < 0.5 else (0.55 if turn < 0.0 else -0.55)
		var base := cell_pos(c) + Vector3(0, DECK[tier], 0)
		match tier:
			3:
				add.call(base - fwd * 0.2, 0.0)
				add.call(base + fwd * 0.12 + Vector3(0, -0.04, 0), 0.0)
			5, 7:
				# Teardrop loop: tighter at the top, drifting sideways so the exit clears the entry.
				var big := tier == 7
				var R := 0.78 if big else 0.58
				var drift := 0.34 if big else 0.3
				var start := base + fwd * 0.05
				var n := 20
				var top := Vector3.ZERO
				for k in n + 1:
					var a := TAU * k / n
					var rr := R * (1.0 - 0.3 * pow(sin(a / 2.0), 2.0))
					var p := start + fwd * sin(a) * rr + Vector3(0, R - cos(a) * rr - (R - rr) * 0.0, 0) + right * (float(k) / n - 0.5) * drift
					p.y = start.y + (R - cos(a) * rr) * (1.0 + 0.1 * sin(a / 2.0))
					add.call(p, 0.0)
					if k == n / 2:
						top = p
				marks["mega_top" if big else "loop_top"] = top
				marks["mega_base" if big else "loop_base"] = start
				add.call(start + fwd * 0.42 + right * drift * 0.5, 0.0)
			4:
				# Helix: a banked turn and a quarter, climbing.
				var r := 0.3
				var s := 1.0 if turn < 0.0 else -1.0
				var side := right * s
				var cen := base - side * 0.0
				var sweep := TAU + PI / 2.0
				var n := 16
				for k in n + 1:
					var ph := sweep * k / n
					var p := cen + (-side * cos(ph) + fwd * sin(ph)) * r + side * 0.0
					p.y = base.y - 0.2 + 0.55 * k / n
					add.call(p, (0.7 if s > 0 else -0.7) * sin(PI * k / n) + bank * 0.0)
				marks["helix"] = cen
			6:
				# Heartline roll: the track twists a full turn in place.
				for k in 7:
					var t := k / 6.0
					var p := base + fwd * (-0.42 + 0.84 * t) + Vector3(0, 0.1 * sin(PI * t), 0)
					add.call(p, TAU * t)
				roll += TAU
				marks["roll"] = base
			_:
				add.call(base, bank)
	# The station: a U-turn under the canopy back to the start.
	for k in 5:
		var ph := PI * k / 4.0
		add.call(Vector3(st_m.x + cos(ph) * 0.5, STATION_Y, st_m.z + sin(ph) * 0.42), 0.0)
	var curve := Curve3D.new()
	curve.bake_interval = 0.03
	curve.up_vector_enabled = true
	var n := pts.size()
	for i in n - 1:
		var a := pts[(i - 1 + n - 1) % (n - 1)] if i > 0 else pts[n - 2]
		var b := pts[i + 1]
		var h := (b - a) * 0.2
		curve.add_point(pts[i], -h, h)
		curve.set_point_tilt(i, tilts[i])
	# Close the circuit on the first point, carrying the accumulated roll.
	var h0 := (pts[1] - pts[n - 2]) * 0.2
	curve.add_point(pts[0], -h0, h0)
	curve.set_point_tilt(curve.point_count - 1, roll)
	track_curve = curve
	track_path = Path3D.new()
	track_path.curve = curve
	add_child(track_path)
	_build_track_mesh(curve)
	_build_train()


func _frame(curve: Curve3D, o: float) -> Array:
	var total := curve.get_baked_length()
	var p := curve.sample_baked(fposmod(o, total), true)
	var q := curve.sample_baked(fposmod(o + 0.02, total), true)
	var fwd := (q - p).normalized()
	var up := curve.sample_baked_up_vector(fposmod(o, total), true)
	var right := fwd.cross(up).normalized()
	up = right.cross(fwd).normalized()
	return [p, fwd, up, right]


func _build_track_mesh(curve: Curve3D) -> void:
	var g := Geo.new()
	var total := curve.get_baked_length()
	var step := total / ceilf(total / 0.035)
	var rail_pts := [[], []]
	var rail_r := [[], []]
	var rail_u := [[], []]
	var spine := []
	var spine_r := []
	var spine_u := []
	var chain := []
	var frames := []
	var o := 0.0
	while o <= total + 0.0001:
		var f := _frame(curve, o)
		frames.append(f)
		track_samples.append(f[0])
		o += step
	for i in frames.size():
		var f: Array = frames[i]
		var p: Vector3 = f[0]
		var fwd: Vector3 = f[1]
		var up: Vector3 = f[2]
		var right: Vector3 = f[3]
		for s in 2:
			rail_pts[s].append(p + right * (0.075 if s == 0 else -0.075))
			rail_r[s].append(right)
			rail_u[s].append(up)
		spine.append(p - up * 0.085)
		spine_r.append(right)
		spine_u.append(up)
		if i % 3 == 0:
			var sp := p - up * 0.085
			for s in [-1.0, 1.0]:
				g.beam(p + right * 0.075 * s - up * 0.012, sp + right * 0.012 * s, 0.018, SPINE)
		# Lift chain on steep climbs.
		if fwd.y > 0.45 and up.y > 0.3:
			chain.append(i)
	g.tube(rail_pts[0], rail_r[0], rail_u[0], 0.022, RAIL, 6)
	g.tube(rail_pts[1], rail_r[1], rail_u[1], 0.022, RAIL, 6)
	g.tube(spine, spine_r, spine_u, 0.036, SPINE, 7)
	for i in chain:
		var f: Array = frames[i]
		if i % 2 == 0:
			g.box(Transform3D(Basis(f[3], f[2], -f[1]), f[0] - f[2] * 0.01), Vector3(0.03, 0.02, 0.028), Color("#3a3550"))
	flush(g, m_gloss)
	_build_supports(frames)


func _build_supports(frames: Array) -> void:
	var g := Geo.new()
	var since := 99.0
	var foot_col := Color("#cfc2a8")
	for i in frames.size():
		since += 0.035
		var f: Array = frames[i]
		var p: Vector3 = f[0]
		var up: Vector3 = f[2]
		if since < 0.42 or up.y < 0.85 or p.y < PLOT_TOP + 0.28 or p.z > 2.6:
			continue
		var top := p - up * 0.11
		# Skip if another run of track passes underneath.
		var blocked := false
		for q in track_samples:
			if q.y < top.y - 0.12 and Vector2(q.x - top.x, q.z - top.z).length() < 0.16:
				blocked = true
				break
		if blocked:
			continue
		since = 0.0
		var ground := Vector3(top.x, PLOT_TOP, top.z)
		var h := top.y - ground.y
		g.cyl(at((top + ground) / 2.0), 0.03, 0.03, h, STEEL, 6)
		g.box(at(ground + Vector3(0, 0.025, 0)), Vector3(0.12, 0.05, 0.12), foot_col, 0.015)
		# Saddle under the spine.
		g.box(Transform3D(Basis(f[3], f[2], -f[1]), top + up * 0.01), Vector3(0.1, 0.03, 0.05), STEEL, 0.008)
		if h > 0.9:
			var side: Vector3 = f[3] * 0.22
			g.beam(ground + side, top - Vector3(0, h * 0.35, 0), 0.025, STEEL)
			g.box(at(ground + side + Vector3(0, 0.02, 0)), Vector3(0.09, 0.04, 0.09), foot_col, 0.01)
	# Loops get A-frame legs up their sides.
	for key in ["loop", "mega"]:
		if not marks.has(key + "_top"):
			continue
		var b: Vector3 = marks[key + "_base"]
		var t: Vector3 = marks[key + "_top"]
		var mid := (b + t) / 2.0
		for s in [-1.0, 1.0]:
			var foot := Vector3(t.x, PLOT_TOP, t.z) + Vector3(0.0, 0, 0.0)
			var off := Vector3(0.36 * s, 0, 0) if absf(t.z - b.z) > absf(t.x - b.x) else Vector3(0, 0, 0.36 * s)
			var leg_top := mid + (t - mid) * 0.35
			g.beam(foot + off, leg_top + off * 0.25, 0.03, STEEL)
			g.box(at(foot + off + Vector3(0, 0.02, 0)), Vector3(0.1, 0.04, 0.1), foot_col, 0.01)
	flush(g, m_matte)


func _build_train() -> void:
	for k in 5:
		# Cars are placed from the same frames the rails use, so they roll with the track.
		var car := Node3D.new()
		add_child(car)
		var body := Geo.new()
		var riders := Geo.new()
		var glow := Geo.new()
		_car(body, glow, k == 0, k == 4)
		for side in [-0.052, 0.052]:
			_rider(riders, Vector3(side, 0.1, 0.02), rng.randf() < 0.3)
		flush(body, m_gloss, car)
		flush(riders, m_matte, car)
		flush(glow, m_glow, car)
		cars.append(car)
	_place_train(9.0)


## One car, front towards -Z: an open red tub with a gold stripe, seats, a lap
## bar and wheels. The lead car gets a nose cone and a headlight, the last a fin.
func _car(g: Geo, glow: Geo, lead: bool, tail: bool) -> void:
	var red := Color("#e8413a")
	var dark := Color("#3a3550")
	# Wheels and chassis.
	for x in [-0.075, 0.075]:
		for z in [-0.09, 0.09]:
			g.cyl(at(Vector3(x, 0.035, z), Basis(Vector3.BACK, PI / 2.0)), 0.032, 0.032, 0.03, dark, 8)
	g.box(at(Vector3(0, 0.06, 0)), Vector3(0.14, 0.035, 0.27), dark, 0.01)
	# Tub.
	g.box(at(Vector3(0, 0.09, 0)), Vector3(0.23, 0.035, 0.28), red, 0.012)
	for x in [-0.1, 0.1]:
		g.box(at(Vector3(x, 0.15, 0)), Vector3(0.03, 0.1, 0.28), red, 0.012)
		g.box(at(Vector3(x * 1.06, 0.145, 0)), Vector3(0.012, 0.022, 0.285), GOLD)
	g.box(at(Vector3(0, 0.165, -0.13)), Vector3(0.23, 0.13, 0.03), red, 0.012)
	g.box(at(Vector3(0, 0.15, 0.13)), Vector3(0.23, 0.1, 0.03), red, 0.012)
	# Seat back and lap bar.
	g.box(at(Vector3(0, 0.19, 0.095)), Vector3(0.18, 0.12, 0.03), NAVY, 0.01)
	g.box(at(Vector3(0, 0.115, 0.03)), Vector3(0.18, 0.025, 0.11), NAVY, 0.008)
	g.beam(Vector3(-0.08, 0.2, -0.06), Vector3(0.08, 0.2, -0.06), 0.016, GOLD)
	g.beam(Vector3(0, 0.2, -0.06), Vector3(0, 0.22, -0.12), 0.016, GOLD)
	if lead:
		g.sphere(Vector3(0, 0.13, -0.17), 0.1, red, Vector3(1.15, 0.8, 1.2), 12, 6, true)
		g.cyl(at(Vector3(0, 0.13, -0.26), Basis(Vector3.RIGHT, PI / 2.0)), 0.06, 0.06, 0.02, GOLD, 10)
		glow.sphere(Vector3(0, 0.13, -0.275), 0.04, Color("#fff4b0"), Vector3.ONE, 8, 5, true)
		g.box(at(Vector3(0, 0.25, -0.13)), Vector3(0.05, 0.05, 0.02), GOLD, 0.01)
	if tail:
		var fin_a := Vector3(0, 0.2, 0.14)
		var fin_b := Vector3(0, 0.34, 0.18)
		var fin_c := Vector3(0, 0.2, 0.2)
		for s in [-1.0, 1.0]:
			g.tri(fin_a, fin_b, fin_c, GOLD, Vector3(0.1 * s, 0.24, 0.17))


## A seated rider: screaming with arms up, or green and hugging their stomach.
func _rider(g: Geo, p: Vector3, sick: bool) -> void:
	var skin: Color = SICK if sick else pick(SKINS)
	var shirt: Color = pick(SHIRTS)
	g.sphere(p + Vector3(0, 0.07, 0.01), 0.045, shirt, Vector3(1.0, 1.25, 0.85), 8, 5)
	g.sphere(p + Vector3(0, 0.165, 0.0), 0.052, skin, Vector3.ONE, 12, 8, true)
	g.sphere(p + Vector3(0, 0.19, 0.008), 0.054, pick(HAIRS), Vector3(1.0, 0.6, 1.0), 10, 5)
	for s in [-1.0, 1.0]:
		g.sphere(p + Vector3(0.019 * s, 0.17, -0.046), 0.009, INK_COL, Vector3(1.0, 1.4, 0.6), 6, 4)
		if sick:
			g.beam(p + Vector3(0.04 * s, 0.1, 0.0), p + Vector3(0.02 * s, 0.06, -0.04), 0.022, shirt)
		else:
			g.beam(p + Vector3(0.04 * s, 0.11, 0.0), p + Vector3(0.075 * s, 0.26, -0.02), 0.022, shirt)
			g.sphere(p + Vector3(0.078 * s, 0.27, -0.02), 0.017, skin, Vector3.ONE, 6, 4)
	# Mouth: a scream, or a puke spout.
	g.sphere(p + Vector3(0, 0.145, -0.048), 0.014, Color("#7a2a3a"), Vector3(1.0, 1.3, 0.5), 6, 4)
	if sick:
		g.sphere(p + Vector3(0, 0.13, -0.08), 0.022, PUKE, Vector3(1.0, 0.8, 1.6), 6, 4)


func _place_train(progress: float) -> void:
	train_progress = progress
	for k in cars.size():
		var f := _frame(track_curve, progress - k * 0.3)
		cars[k].transform = Transform3D(Basis(f[3], f[2], -f[1]), f[0])


func offset_near(p: Vector3) -> float:
	return track_curve.get_closest_offset(p)


# ---- Station -----------------------------------------------------------------

func _build_station() -> void:
	var c := (cell_pos(Vector2i(1, 5)) + cell_pos(Vector2i(2, 5))) / 2.0
	c.y = 0.0
	var g := g_matte
	g.box(at(c + Vector3(0, 0.15, 0.08)), Vector3(2.3, 0.3, 1.2), Color("#b3a7c6"), 0.05)
	g.box(at(c + Vector3(0, 0.31, 0.08)), Vector3(2.2, 0.03, 1.1), Color("#d8d0e6"), 0.01)
	g.box(at(c + Vector3(0, 0.33, 0.64)), Vector3(2.2, 0.012, 0.05), GOLD)
	# Posts.
	for x in [-1.05, 0.0, 1.05]:
		g.cyl(at(c + Vector3(x, 0.8, 0.62)), 0.035, 0.035, 1.0, NAVY, 8)
		g.cyl(at(c + Vector3(x, 0.34, 0.62)), 0.06, 0.06, 0.05, GOLD, 8)
	# Striped, scalloped canopy over the front half only, so the board stays visible.
	var stripes := 12
	var x0 := -1.2
	var w := 2.4 / stripes
	var back_y := 1.38
	var front_y := 1.18
	var z_back := 0.2
	var z_front := 0.85
	for k in stripes:
		var col := STRIPE_RED if k % 2 == 0 else CREAM
		var xa := x0 + k * w
		var xb := xa + w
		var a := c + Vector3(xa, back_y, z_back)
		var b := c + Vector3(xb, back_y, z_back)
		var d := c + Vector3(xa, front_y, z_front)
		var e := c + Vector3(xb, front_y, z_front)
		g.quad(a, b, e, d, col, (a + e) / 2.0 - Vector3(0, 1, 0.1))
		g.quad(a, b, e, d, col.darkened(0.25), (a + e) / 2.0 + Vector3(0, 1, 0.1))
		# Scallop.
		var cen := (d + e) / 2.0
		for s in 6:
			var a0 := PI * s / 6.0
			var a1 := PI * (s + 1) / 6.0
			var p0 := cen + Vector3(-cos(a0) * w / 2.0, -sin(a0) * w * 0.55, 0)
			var p1 := cen + Vector3(-cos(a1) * w / 2.0, -sin(a1) * w * 0.55, 0)
			g.tri(cen, p0, p1, col, cen - Vector3(0, 0, 1))
			g.tri(cen, p0, p1, col, cen + Vector3(0, 0, 1))
	g.box(at(c + Vector3(0, back_y + 0.02, z_back)), Vector3(2.45, 0.05, 0.06), GOLD, 0.01)
	# Sign with light bulbs.
	var sc := c + Vector3(0, 1.72, 0.28)
	g.box(at(sc), Vector3(1.5, 0.38, 0.07), STRIPE_RED, 0.03)
	g.box(at(sc + Vector3(0, 0, 0.02)), Vector3(1.38, 0.28, 0.05), CREAM, 0.02)
	for x in [-0.5, 0.5]:
		g.cyl(at(c + Vector3(x, 1.5, 0.28)), 0.02, 0.02, 0.2, NAVY, 6)
	for k in 14:
		var t := k / 13.0
		g_glow.sphere(sc + Vector3(-0.7 + 1.4 * t, 0.19, 0.04), 0.018, Color("#fff1a8"), Vector3.ONE, 6, 4)
		g_glow.sphere(sc + Vector3(-0.7 + 1.4 * t, -0.19, 0.04), 0.018, Color("#fff1a8"), Vector3.ONE, 6, 4)
	var label := Label3D.new()
	label.text = "LOOPHOLE"
	label.font_size = 96
	label.pixel_size = 0.0022
	label.outline_size = 0
	label.modulate = STRIPE_RED.darkened(0.15)
	label.shaded = false
	label.double_sided = false
	label.alpha_cut = Label3D.ALPHA_CUT_OPAQUE_PREPASS
	label.position = sc + Vector3(0, -0.005, 0.052)
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["DejaVu Sans"])
	font.font_weight = 800
	label.font = font
	add_child(label)
	# Queue rails in front of the station.
	var lanes := [4.15, 4.55]
	for z in lanes:
		var posts := []
		for x in [-1.3, -0.4, 0.5, 1.4]:
			posts.append(Vector3(x, 0, z))
		for p in posts:
			g.cyl(at(p + Vector3(0, 0.17, 0)), 0.022, 0.022, 0.34, NAVY, 6)
			g.sphere(p + Vector3(0, 0.35, 0), 0.03, GOLD, Vector3.ONE, 6, 4)
			g.cyl(at(p + Vector3(0, 0.01, 0)), 0.06, 0.06, 0.02, NAVY, 8)
		for i in posts.size() - 1:
			var a: Vector3 = posts[i] + Vector3(0, 0.3, 0)
			var b: Vector3 = posts[i + 1] + Vector3(0, 0.3, 0)
			var mids := []
			for k in 7:
				var t := k / 6.0
				mids.append(a.lerp(b, t) - Vector3(0, 0.06 * 4.0 * t * (1.0 - t), 0))
			tube_along(g, mids, 0.012, STRIPE_RED, 5)


# ---- Trees -------------------------------------------------------------------

func _tree(pos: Vector3, force_pine := -1) -> void:
	var s := rng.randf_range(0.8, 1.25)
	var pine := rng.randf() < 0.4 if force_pine < 0 else force_pine == 1
	var trunk := Color("#7a4a2e")
	if pine:
		g_matte.cyl(at(pos + Vector3(0, 0.2 * s, 0)), 0.08 * s, 0.06 * s, 0.4 * s, trunk, 6)
		var c: Color = jitter(pick(EVERGREEN), 0.03)
		for k in 3:
			var col := c.lightened(k * 0.06)
			col.a = 0.5
			g_leaf.cyl(at(pos + Vector3(0, (0.55 + k * 0.33) * s, 0), Basis(Vector3.UP, rng.randf() * TAU)), (0.55 - k * 0.13) * s, 0.0, (0.62 - k * 0.06) * s, col, 7)
	else:
		g_matte.cyl(at(pos + Vector3(0, 0.3 * s, 0)), 0.09 * s, 0.06 * s, 0.6 * s, trunk, 6)
		var pal: Array = AUTUMN if rng.randf() < 0.6 else EVERGREEN
		var c: Color = jitter(pick(pal), 0.03)
		c.a = 0.4
		var cen := pos + Vector3(0, 0.95 * s, 0)
		g_leaf.blob(cen, 0.46 * s, c, rng.randi(), 0.16)
		for k in rng.randi_range(2, 4):
			var a := rng.randf() * TAU
			var o := Vector3(cos(a) * 0.3, rng.randf_range(-0.05, 0.3), sin(a) * 0.3) * s
			g_leaf.blob(cen + o, rng.randf_range(0.24, 0.32) * s, c.lightened(rng.randf_range(0.0, 0.1)), rng.randi(), 0.18)


func _build_trees() -> void:
	var placed := 0
	var tries := 0
	while placed < 190 and tries < 4000:
		tries += 1
		var th := rng.randf() * TAU
		var r := rng.randf_range(7.9, island_radius(th) - 0.5)
		var p := Vector2(cos(th), sin(th)) * r
		if _on_path(th, r) or p.distance_to(Vector2(cos(1.05), sin(1.05)) * (island_radius(1.05) - 3.3)) < 1.4:
			continue
		if absf(wrapf(th - 1.05, -PI, PI)) * r < 0.5 and r > island_radius(th) - 2.6:
			continue
		_tree(Vector3(p.x, island_height(p), p.y))
		placed += 1
	for p in [Vector3(-6.2, 0, 2.8), Vector3(6.3, 0, 3.4), Vector3(-6.4, 0, -3.8), Vector3(6.4, 0, -2.2)]:
		g_matte.cyl(at(p + Vector3(0, 0.08, 0)), 0.42, 0.45, 0.16, Color("#d8c7a4"), 12, Color("#7a5a3a"))
		_tree(p + Vector3(0, 0.16, 0), 0)


# ---- Rides and dressing ------------------------------------------------------

func _build_rides() -> void:
	_build_ferris_wheel(Vector3(-3.9, 0, -5.4))
	_build_drop_tower(Vector3(4.6, 0, -4.6))
	_build_carousel(Vector3(-5.0, 0, -1.2))
	_build_food_stand(Vector3(5.1, 0, 1.2))


func _build_ferris_wheel(pos: Vector3) -> void:
	var yaw := PI / 4.0
	var basis := yaw_basis(yaw)
	var R := 1.7
	wheel_hub = pos + Vector3(0, R + 0.45, 0)
	var g := g_matte
	g.box(at(pos + Vector3(0, 0.08, 0), basis), Vector3(1.6, 0.16, 1.0), Color("#d8c7a4"), 0.04)
	for s in [-1.0, 1.0]:
		var zoff := basis * Vector3(0, 0, 0.32 * s)
		for x in [-0.75, 0.75]:
			g.beam(pos + basis * Vector3(x, 0.15, 0) + zoff, wheel_hub + zoff * 0.7, 0.07, CREAM)
	g.cyl(at(wheel_hub, basis * Basis(Vector3.RIGHT, PI / 2.0)), 0.07, 0.07, 0.75, NAVY, 8)
	wheel = Node3D.new()
	wheel.position = wheel_hub
	wheel.rotation.y = yaw
	add_child(wheel)
	var wg := Geo.new()
	var wglow := Geo.new()
	var spokes := 12
	for s in [-1.0, 1.0]:
		var ring := []
		for k in 48:
			var a := TAU * k / 48.0
			ring.append(Vector3(cos(a) * R, sin(a) * R, 0.13 * s))
		tube_along(wg, ring, 0.035, STRIPE_RED, 6, true)
		var inner := []
		for k in 36:
			var a := TAU * k / 36.0
			inner.append(Vector3(cos(a) * R * 0.55, sin(a) * R * 0.55, 0.13 * s))
		tube_along(wg, inner, 0.022, CREAM, 5, true)
		for k in spokes:
			var a := TAU * k / spokes
			wg.beam(Vector3(0, 0, 0.1 * s), Vector3(cos(a) * R, sin(a) * R, 0.13 * s), 0.025, CREAM)
	for k in spokes:
		var a := TAU * k / spokes
		wg.beam(Vector3(cos(a) * R, sin(a) * R, -0.13), Vector3(cos(a) * R, sin(a) * R, 0.13), 0.03, CREAM)
	for k in 36:
		var a := TAU * (k + 0.5) / 36.0
		wglow.sphere(Vector3(cos(a) * R * 1.02, sin(a) * R * 1.02, 0.16), 0.025, Color("#fff1a8"), Vector3.ONE, 6, 4)
	wg.cyl(at(Vector3.ZERO, Basis(Vector3.RIGHT, PI / 2.0)), 0.16, 0.16, 0.3, GOLD, 10)
	flush(wg, m_gloss, wheel)
	flush(wglow, m_glow, wheel)
	var cols := [Color("#45a8e0"), GOLD, Color("#72c457"), Color("#ff8fb8"), Color("#9d6ef0"), Color("#ff9a3c")]
	for k in spokes:
		var gn := Node3D.new()
		add_child(gn)
		var cg := Geo.new()
		var col: Color = cols[k % cols.size()]
		cg.beam(Vector3(0, 0.0, 0), Vector3(0, -0.12, 0), 0.02, NAVY)
		cg.box(at(Vector3(0, -0.24, 0)), Vector3(0.26, 0.2, 0.2), col, 0.04)
		cg.box(at(Vector3(0, -0.2, 0.0)), Vector3(0.2, 0.08, 0.21), Color("#cfe8ff"), 0.0)
		cg.cyl(at(Vector3(0, -0.11, 0)), 0.03, 0.18, 0.08, col.lightened(0.2), 8)
		flush(cg, m_gloss, gn)
		gondolas.append(gn)
	_update_wheel(0.0)


func _update_wheel(angle: float) -> void:
	if wheel == null:
		return
	wheel.rotation = Vector3(0, PI / 4.0, 0)
	wheel.rotate_object_local(Vector3.BACK, angle)
	for k in gondolas.size():
		var a := TAU * k / gondolas.size() + angle
		gondolas[k].position = wheel_hub + yaw_basis(PI / 4.0) * Vector3(cos(a) * 1.7, sin(a) * 1.7, 0)
		gondolas[k].rotation.y = PI / 4.0


func _build_drop_tower(pos: Vector3) -> void:
	var g := g_matte
	var h := 5.4
	g.box(at(pos + Vector3(0, 0.1, 0)), Vector3(1.3, 0.2, 1.3), Color("#d8c7a4"), 0.05)
	g.cyl(at(pos + Vector3(0, 0.26, 0)), 0.5, 0.55, 0.12, NAVY, 10)
	var bands := 11
	for k in bands:
		var col := STRIPE_RED if k % 2 == 0 else CREAM
		g_gloss.cyl(at(pos + Vector3(0, 0.32 + (k + 0.5) * h / bands, 0)), 0.16, 0.16, h / bands, col, 10)
	var top := pos + Vector3(0, 0.32 + h, 0)
	g_gloss.cyl(at(top + Vector3(0, 0.1, 0)), 0.34, 0.3, 0.2, GOLD, 12)
	g_gloss.cyl(at(top + Vector3(0, 0.4, 0)), 0.0, 0.32, 0.4, STRIPE_RED, 12)
	g.beam(top + Vector3(0, 0.55, 0), top + Vector3(0, 0.95, 0), 0.02, NAVY)
	g.tri(top + Vector3(0, 0.95, 0), top + Vector3(0, 0.78, 0), top + Vector3(0.28, 0.87, 0.0), GOLD, top + Vector3(0.1, 0.87, -1))
	g.tri(top + Vector3(0, 0.95, 0), top + Vector3(0, 0.78, 0), top + Vector3(0.28, 0.87, 0.0), GOLD, top + Vector3(0.1, 0.87, 1))
	for k in 8:
		var a := TAU * k / 8.0
		g_glow.sphere(top + Vector3(cos(a) * 0.35, 0.1, sin(a) * 0.35), 0.03, Color("#fff1a8"), Vector3.ONE, 6, 4)
	for k in 10:
		g_glow.sphere(pos + Vector3(0.0, 0.6 + k * 0.5, 0.17), 0.025, Color("#ffcf6a"), Vector3.ONE, 6, 4)
	# The gondola ring, parked high with riders' legs dangling.
	var ry := pos.y + 3.7
	g_gloss.cyl(at(Vector3(pos.x, ry, pos.z)), 0.52, 0.52, 0.2, Color("#2d9aa8"), 16)
	for k in 10:
		var a := TAU * k / 10.0
		var p := pos + Vector3(cos(a) * 0.48, 0, sin(a) * 0.48)
		g.sphere(Vector3(p.x, ry + 0.16, p.z), 0.05, pick(SKINS), Vector3.ONE, 8, 5, true)
		g.beam(Vector3(p.x, ry - 0.08, p.z), Vector3(p.x, ry - 0.25, p.z), 0.03, pick(PANTS))


func _build_carousel(cp: Vector3) -> void:
	var g := g_matte
	g.cyl(at(cp + Vector3(0, 0.08, 0)), 1.15, 1.2, 0.16, Color("#d8c7a4"), 20, Color("#f4e7c8"))
	g.cyl(at(cp + Vector3(0, 0.9, 0)), 0.1, 0.1, 1.5, GOLD, 10)
	var horse_cols := [CREAM, Color("#ffd9a8"), Color("#cfe8ff"), Color("#ffc9da")]
	for k in 8:
		var a := TAU * k / 8.0
		var hp := cp + Vector3(cos(a) * 0.82, 0, sin(a) * 0.82)
		g.cyl(at(hp + Vector3(0, 0.85, 0)), 0.018, 0.018, 1.4, GOLD, 5)
		var fwd := Vector3(-sin(a), 0, cos(a))
		var hy := 0.55 + 0.1 * sin(a * 3.0)
		var col: Color = horse_cols[k % 4]
		g.sphere(hp + Vector3(0, hy, 0), 0.12, col, Vector3(0.8, 0.75, 1.5), 8, 5, false, Basis.looking_at(fwd))
		g.sphere(hp + fwd * 0.18 + Vector3(0, hy + 0.12, 0), 0.07, col, Vector3(0.8, 1.1, 1.0), 8, 5)
		g.sphere(hp - fwd * 0.03 + Vector3(0, hy + 0.1, 0), 0.05, STRIPE_RED, Vector3(1.0, 0.5, 1.2), 6, 4)
		for s in [-1.0, 1.0]:
			g.beam(hp + fwd * 0.1 * s + Vector3(0, hy - 0.05, 0), hp + fwd * 0.16 * s + Vector3(0, hy - 0.25, 0), 0.03, col)
	# Striped cone roof with a scalloped valance.
	var segs := 16
	var roof_y := 1.6
	var apex := cp + Vector3(0, roof_y + 0.65, 0)
	for k in segs:
		var a0 := TAU * k / segs
		var a1 := TAU * (k + 1) / segs
		var p0 := cp + Vector3(cos(a0) * 1.35, roof_y, sin(a0) * 1.35)
		var p1 := cp + Vector3(cos(a1) * 1.35, roof_y, sin(a1) * 1.35)
		var col := STRIPE_RED if k % 2 == 0 else CREAM
		g_gloss.tri(apex, p0, p1, col, cp + Vector3(0, roof_y, 0))
		g_gloss.tri(apex, p0, p1, col.darkened(0.3), cp + Vector3(0, roof_y + 2.0, 0))
		var mid := (p0 + p1) / 2.0
		var out := Vector3(mid.x - cp.x, 0, mid.z - cp.z).normalized()
		for s in 5:
			var b0 := PI * s / 5.0
			var b1 := PI * (s + 1) / 5.0
			var q0 := p0.lerp(p1, 0.5 - cos(b0) * 0.5) - Vector3(0, sin(b0) * 0.14, 0)
			var q1 := p0.lerp(p1, 0.5 - cos(b1) * 0.5) - Vector3(0, sin(b1) * 0.14, 0)
			g_gloss.tri(mid, q0, q1, col, mid - out)
			g_gloss.tri(mid, q0, q1, col, mid + out)
		g_glow.sphere(p0 + Vector3(0, -0.02, 0) + (p0 - cp).normalized() * 0.02, 0.028, Color("#fff1a8"), Vector3.ONE, 6, 4)
	g_gloss.sphere(apex + Vector3(0, 0.06, 0), 0.08, GOLD, Vector3.ONE, 8, 5, true)
	g.beam(apex + Vector3(0, 0.1, 0), apex + Vector3(0, 0.45, 0), 0.018, NAVY)
	g.tri(apex + Vector3(0, 0.45, 0), apex + Vector3(0, 0.3, 0), apex + Vector3(0.25, 0.38, 0), STRIPE_RED, apex + Vector3(0.1, 0.38, -1))
	g.tri(apex + Vector3(0, 0.45, 0), apex + Vector3(0, 0.3, 0), apex + Vector3(0.25, 0.38, 0), STRIPE_RED, apex + Vector3(0.1, 0.38, 1))
	carousel = null


func _build_food_stand(fp: Vector3) -> void:
	var g := g_matte
	var b := yaw_basis(-0.3)
	var xf := func(v: Vector3) -> Vector3: return fp + b * v
	g.box(at(xf.call(Vector3(0, 0.4, 0)), b), Vector3(1.1, 0.8, 0.7), CREAM, 0.04)
	g.box(at(xf.call(Vector3(0, 0.25, 0.34)), b), Vector3(1.0, 0.36, 0.04), Color("#45a8e0"), 0.02)
	g.box(at(xf.call(Vector3(0, 0.62, 0.36)), b), Vector3(1.12, 0.05, 0.12), Color("#b98a5a"), 0.015)
	for k in 6:
		var col := STRIPE_RED if k % 2 == 0 else CREAM
		var x0 := -0.6 + k * 0.2
		var a: Vector3 = xf.call(Vector3(x0, 1.05, 0.05))
		var bb: Vector3 = xf.call(Vector3(x0 + 0.2, 1.05, 0.05))
		var d: Vector3 = xf.call(Vector3(x0, 0.9, 0.62))
		var e: Vector3 = xf.call(Vector3(x0 + 0.2, 0.9, 0.62))
		g.quad(a, bb, e, d, col, (a + e) / 2.0 - Vector3.UP)
		g.quad(a, bb, e, d, col.darkened(0.25), (a + e) / 2.0 + Vector3.UP)
		var cen := (d + e) / 2.0
		for s in 4:
			var b0 := PI * s / 4.0
			var b1 := PI * (s + 1) / 4.0
			var q0 := d.lerp(e, 0.5 - cos(b0) * 0.5) - Vector3(0, sin(b0) * 0.07, 0)
			var q1 := d.lerp(e, 0.5 - cos(b1) * 0.5) - Vector3(0, sin(b1) * 0.07, 0)
			g.tri(cen, q0, q1, col, cen - b * Vector3(0, 0, 1))
			g.tri(cen, q0, q1, col, cen + b * Vector3(0, 0, 1))
	# A giant corn dog on the roof.
	var cd: Vector3 = xf.call(Vector3(0, 1.1, -0.1))
	var tilt := b * Basis(Vector3.BACK, 0.35)
	g.beam(cd, cd + tilt * Vector3(0, 0.75, 0), 0.03, Color("#e8c890"))
	g_gloss.sphere(cd + tilt * Vector3(0, 0.55, 0), 0.13, Color("#d9892f"), Vector3(1.0, 2.1, 1.0), 10, 7, true, tilt)
	g_gloss.beam(cd + tilt * Vector3(0.1, 0.35, 0.1), cd + tilt * Vector3(-0.02, 0.8, 0.13), 0.025, Color("#ffd23f"))


func _build_dressing() -> void:
	# Lamps around the plaza, strung together with bunting.
	var lamp_pos := []
	for k in 10:
		var a := TAU * k / 10.0 + 0.15
		if _on_path(a, 6.9):
			a += 0.2
		var lp := Vector3(cos(a) * 6.9, 0, sin(a) * 6.9)
		lamp_pos.append(lp)
		g_matte.cyl(at(lp + Vector3(0, 0.05, 0)), 0.09, 0.1, 0.1, NAVY, 8)
		g_matte.cyl(at(lp + Vector3(0, 0.62, 0)), 0.03, 0.035, 1.15, NAVY, 6)
		g_matte.cyl(at(lp + Vector3(0, 1.28, 0)), 0.0, 0.12, 0.1, NAVY, 8)
		g_glow.sphere(lp + Vector3(0, 1.19, 0), 0.075, Color("#ffe9a0"), Vector3.ONE, 8, 5, true)
		var light := OmniLight3D.new()
		light.position = lp + Vector3(0, 1.1, 0)
		light.light_color = Color("#ffc870")
		light.omni_range = 2.3
		light.light_energy = 0.0
		add_child(light)
		lamps.append(light)
	for k in lamp_pos.size():
		var a: Vector3 = lamp_pos[k]
		var b: Vector3 = lamp_pos[(k + 1) % lamp_pos.size()]
		bunting(a + Vector3(0, 1.1, 0), b + Vector3(0, 1.1, 0), 0.3, 11)
	# Benches.
	for p in [Vector3(-3.3, 0, 5.3), Vector3(3.4, 0, 5.2), Vector3(-6.2, 0, 1.0), Vector3(-1.6, 0, -4.9)]:
		var yaw := atan2(p.x, p.z)
		var b := yaw_basis(yaw)
		g_matte.box(at(p + Vector3(0, 0.2, 0), b), Vector3(0.75, 0.05, 0.24), Color("#c07a45"), 0.015)
		g_matte.box(at(p + b * Vector3(0, 0.34, -0.11), b), Vector3(0.75, 0.16, 0.04), Color("#c07a45"), 0.015)
		for x in [-0.3, 0.3]:
			g_matte.box(at(p + b * Vector3(x, 0.1, 0), b), Vector3(0.05, 0.2, 0.2), NAVY)
	# Hedges and flower boxes along the plaza edge.
	for k in 40:
		var a := TAU * (k + 0.5) / 40.0
		if _on_path(a, 7.8):
			continue
		var p := Vector3(cos(a) * 7.75, 0.12, sin(a) * 7.75)
		var col := jitter(Color("#3f9a52"), 0.03)
		col.a = 0.7
		g_leaf.blob(p, 0.3, col, rng.randi(), 0.12, Vector3(1.0, 0.75, 1.0))
		if k % 3 == 0:
			for f in 3:
				g_matte.blob(p + Vector3(rng.randf_range(-0.2, 0.2), 0.2, rng.randf_range(-0.2, 0.2)), 0.05, pick([Color("#ff5d8a"), Color("#ffd23f"), Color("#ffffff")]), rng.randi())
	# A balloon seller by the queue.
	var bp := Vector3(-2.2, 0, 5.2)
	_guest(g_matte, bp, 0.3, {"shirt": Color("#9d6ef0"), "hat": "cap"})
	var bal_cols := [STRIPE_RED, GOLD, Color("#45a8e0"), Color("#72c457"), Color("#ff8fb8"), CREAM]
	for k in 7:
		var tip := bp + Vector3(rng.randf_range(-0.35, 0.35), rng.randf_range(0.95, 1.3), rng.randf_range(-0.3, 0.3))
		g_matte.beam(bp + Vector3(0.08, 0.2, 0.05), tip, 0.006, NAVY)
		g_gloss.sphere(tip + Vector3(0, 0.1, 0), 0.1, bal_cols[k % bal_cols.size()], Vector3(1.0, 1.2, 1.0), 10, 7, true)


# ---- Guests ------------------------------------------------------------------

## A chibi guest, 0.45 m tall, facing local +Z. Options: skin, shirt, hat
## ("cap", "bun", "spiky", "bob"), sick (green, doubled over), big (a boss).
func _guest(g: Geo, pos: Vector3, yaw: float, opts := {}) -> void:
	var s: float = opts.get("scale", rng.randf_range(0.92, 1.06))
	var b := yaw_basis(yaw)
	var sick: bool = opts.get("sick", false)
	var skin: Color = SICK if sick else opts.get("skin", pick(SKINS))
	var shirt: Color = opts.get("shirt", pick(SHIRTS))
	var pants: Color = opts.get("pants", pick(PANTS))
	var hair: Color = opts.get("hair", pick(HAIRS))
	var hat: String = opts.get("hat", pick(["cap", "bun", "spiky", "bob", "none", "none"]))
	var lean := Basis(Vector3.RIGHT, 0.45) if sick else Basis()
	var P := func(v: Vector3) -> Vector3: return pos + b * (v * s)
	var PL := func(v: Vector3) -> Vector3: return pos + b * ((Vector3(0, 0.12, 0) + lean * (v - Vector3(0, 0.12, 0))) * s)
	for x in [-0.032, 0.032]:
		g.cyl(at(P.call(Vector3(x, 0.06, 0)), b), 0.024 * s, 0.024 * s, 0.12 * s, pants, 6)
		g.sphere(P.call(Vector3(x, 0.012, 0.015)), 0.026 * s, Color("#3a3550"), Vector3(1.0, 0.5, 1.4), 6, 3, false, b)
	var belly: float = opts.get("belly", 1.0)
	g.sphere(PL.call(Vector3(0, 0.175, 0)), 0.072 * s, shirt, Vector3(belly, 1.05, 0.88 * belly), 10, 6, false, b * lean)
	var head_c: Vector3 = PL.call(Vector3(0, 0.33, 0))
	var hr := 0.1 * s
	var hb := b * lean
	g.sphere(head_c, hr, skin, Vector3.ONE, 14, 9, true, hb)
	# Face: eyes and rosy cheeks.
	for x in [-1.0, 1.0]:
		g.sphere(head_c + hb * Vector3(0.036 * x, 0.004, 0.09) * s, 0.015 * s, INK_COL, Vector3(0.85, 1.35, 0.5), 6, 4, false, hb)
		g.sphere(head_c + hb * Vector3(0.06 * x, -0.03, 0.075) * s, 0.017 * s, Color("#ff9a9a"), Vector3(1.0, 0.6, 0.4), 6, 3, false, hb)
	# Hair.
	match hat:
		"cap":
			g.sphere(head_c + hb * Vector3(0, 0.035, -0.005) * s, hr * 1.03, shirt.darkened(0.2), Vector3(1.0, 0.62, 1.0), 10, 5, false, hb)
			g.box(Transform3D(hb, head_c + hb * Vector3(0, 0.06, 0.085) * s), Vector3(0.13, 0.015, 0.09) * s, shirt.darkened(0.2), 0.005)
		"bun":
			g.sphere(head_c + hb * Vector3(0, 0.03, -0.012) * s, hr * 1.04, hair, Vector3(1.0, 0.7, 1.0), 10, 5, false, hb)
			g.sphere(head_c + hb * Vector3(0, 0.1, -0.05) * s, 0.045 * s, hair, Vector3.ONE, 8, 5, true, hb)
		"spiky":
			for k in 6:
				var a := TAU * k / 6.0
				var root: Vector3 = head_c + hb * Vector3(cos(a) * 0.05, 0.07, sin(a) * 0.05 - 0.01) * s
				g.cyl(Transform3D(hb * Basis(Vector3(sin(a), 0, -cos(a)).normalized(), 0.5), root), 0.028 * s, 0.0, 0.08 * s, hair, 4)
			g.sphere(head_c + hb * Vector3(0, 0.03, -0.01) * s, hr * 1.02, hair, Vector3(1.0, 0.62, 1.0), 10, 5, false, hb)
		"bob":
			g.sphere(head_c + hb * Vector3(0, 0.012, -0.018) * s, hr * 1.1, hair, Vector3(1.0, 0.88, 1.0), 10, 6, false, hb)
		_:
			g.sphere(head_c + hb * Vector3(0, 0.04, -0.01) * s, hr * 1.01, hair, Vector3(1.0, 0.55, 1.0), 10, 5, false, hb)
	# Arms: up and cheering, down, or clutching the stomach when sick.
	var cheer: bool = opts.get("cheer", false)
	for x in [-1.0, 1.0]:
		var sh: Vector3 = PL.call(Vector3(0.065 * x, 0.21, 0))
		var hand: Vector3
		if sick:
			hand = PL.call(Vector3(0.025 * x, 0.15, 0.08))
		elif cheer:
			hand = PL.call(Vector3(0.11 * x, 0.36, 0.02))
		else:
			hand = PL.call(Vector3(0.085 * x, 0.1, 0.01))
		g.beam(sh, hand, 0.03 * s, shirt)
		g.sphere(hand, 0.022 * s, skin, Vector3.ONE, 6, 4)
	if sick:
		# Mid-puke: a lime arc to a puddle.
		var mouth: Vector3 = head_c + hb * Vector3(0, -0.04, 0.1) * s
		var floor_p: Vector3 = pos + b * Vector3(0, 0.0, 0.28 * s)
		var arc := []
		for k in 6:
			var t := k / 5.0
			arc.append(mouth.lerp(floor_p, t) + Vector3(0, 0.08 * sin(PI * t) * s, 0) + b * Vector3(0, 0, 0.04 * sin(PI * t)))
		tube_along(g, arc, 0.018 * s, PUKE, 5)
		puddle(floor_p, 0.12 * s)


func puddle(p: Vector3, r: float) -> void:
	for k in 4:
		var o := Vector3(rng.randf_range(-1, 1), 0, rng.randf_range(-1, 1)) * r * 0.6
		g_matte.sphere(p + o + Vector3(0, 0.05, 0), r * rng.randf_range(0.5, 0.9), PUKE, Vector3(1.0, 0.12, 1.0), 8, 3)


func _free_spot(p: Vector3) -> bool:
	if _in_plot_area(p) or p.length() > 6.9 or p.length() < 3.0:
		return false
	for c in [[Vector3(-5.0, 0, -1.2), 1.5], [Vector3(5.1, 0, 1.2), 0.9], [Vector3(-3.9, 0, -5.4), 1.3], [Vector3(4.6, 0, -4.6), 0.95], [Vector3(-2.2, 0, 5.2), 0.5]]:
		if p.distance_to(c[0]) < c[1]:
			return false
	return true


func _build_guests() -> void:
	# The queue along the rails, with Big Barry up front.
	var entry := Vector3(-1.75, 0, 4.15)
	_guest(g_matte, entry + Vector3(0.05, 0, -0.05), PI * 0.85, {"scale": 2.0, "shirt": Color("#e8413a"), "hat": "cap", "belly": 1.35, "skin": SKINS[1]})
	for k in 7:
		_guest(g_matte, Vector3(-0.9 + k * 0.36, 0, 4.35 + rng.randf_range(-0.04, 0.04)), -PI / 2.0 + rng.randf_range(-0.4, 0.4))
	for k in 6:
		_guest(g_matte, Vector3(1.3 - k * 0.36, 0, 4.78 + rng.randf_range(-0.04, 0.04)), PI / 2.0 + rng.randf_range(-0.4, 0.4))
	# Two just off the ride, green, and the evidence.
	_guest(g_matte, Vector3(1.9, 0, 3.9), 0.6, {"sick": true})
	_guest(g_matte, Vector3(2.6, 0, 4.4), 1.9, {"sick": true, "hat": "bob"})
	puddle(Vector3(2.35, 0, 3.55), 0.14)
	# Visitors around the plaza, most of them watching the coaster.
	var placed := 0
	var tries := 0
	while placed < 70 and tries < 3000:
		tries += 1
		var th := rng.randf() * TAU
		var r := rng.randf_range(3.2, 6.8)
		var p := Vector3(cos(th) * r, 0, sin(th) * r)
		if not _free_spot(p):
			continue
		var to_ride := Vector3(0, 0, 0) - p
		var yaw := atan2(to_ride.x, to_ride.z) + rng.randf_range(-0.6, 0.6)
		if rng.randf() < 0.3:
			yaw = rng.randf() * TAU
		var opts := {}
		var roll_d := rng.randf()
		if roll_d < 0.12:
			opts["sick"] = true
		elif roll_d < 0.3:
			opts["cheer"] = true
		_guest(g_matte, p, yaw, opts)
		placed += 1
		# Little groups.
		if rng.randf() < 0.35:
			var q := p + Vector3(rng.randf_range(-0.35, 0.35), 0, rng.randf_range(-0.35, 0.35))
			if _free_spot(q):
				_guest(g_matte, q, yaw + rng.randf_range(-0.5, 0.5), {"scale": 0.75, "cheer": rng.randf() < 0.5})


# ---- Camera, input, screenshots ----------------------------------------------

const CAMERAS := 6


func _iso(target: Vector3, size: float, yaw_deg: float, pitch_deg: float) -> void:
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = size
	var yaw := deg_to_rad(yaw_deg)
	var pitch := deg_to_rad(pitch_deg)
	cam.position = target + Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * 40.0
	cam.look_at(target)


func _persp(pos: Vector3, target: Vector3, fov: float) -> void:
	cam.projection = Camera3D.PROJECTION_PERSPECTIVE
	cam.fov = fov
	cam.position = pos
	cam.look_at(target)


func _set_camera(mode: int) -> void:
	cam_mode = mode
	_pick_camera(mode)
	ink_mat.set_shader_parameter("ortho", cam.projection == Camera3D.PROJECTION_ORTHOGONAL)
	ink_mat.set_shader_parameter("cam_near", cam.near)
	ink_mat.set_shader_parameter("cam_far", cam.far)


func _pick_camera(mode: int) -> void:
	match mode:
		0:
			_iso(Vector3(0, 0.2, 0.6), 27.0, 45.0, 33.0)
		1:
			_iso(Vector3(0.1, 0.55, 0.9), 8.2, 45.0, 36.0)
		2:
			var t: Vector3 = marks.get("mega_top", Vector3(2, 1.5, -1))
			_persp(t + Vector3(2.5, -0.35, 1.25), t + Vector3(-0.2, -0.5, -0.1), 44.0)
		3:
			var t: Vector3 = marks.get("loop_top", Vector3(-1, 1.5, -1))
			_persp(t + Vector3(-2.4, 0.0, 1.2), t + Vector3(0.3, -0.45, -0.2), 42.0)
		4:
			_persp(Vector3(20.0, 3.4, 21.0), Vector3(-1.0, 1.4, -1.0), 30.0)
		5:
			_persp(Vector3(6.2, 4.6, 7.6), Vector3(0.6, 0.8, 0.0), 38.0)


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	match event.keycode:
		KEY_LEFT: _swipe(Vector2i(-1, 0))
		KEY_RIGHT: _swipe(Vector2i(1, 0))
		KEY_UP: _swipe(Vector2i(0, -1))
		KEY_DOWN: _swipe(Vector2i(0, 1))
		KEY_C: _set_camera((cam_mode + 1) % CAMERAS)
		KEY_T: _set_time(not sunset)


var wheel_angle := 0.0


func _process(delta: float) -> void:
	if shooting or cars.is_empty():
		return
	# Speed from height: slow over the crests, fast through the loops.
	var y := cars[0].global_position.y
	train_speed = lerpf(train_speed, clampf(sqrt(maxf(0.1, 2.0 * 9.8 * 0.18 * (2.6 - y))), 0.7, 3.2), 0.1)
	_place_train(train_progress + delta * train_speed)
	wheel_angle += delta * 0.25
	_update_wheel(wheel_angle)


func _render_shots() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://shots"))
	var mega := offset_near(marks.get("mega_top", Vector3.ZERO))
	var loop := offset_near(marks.get("loop_top", Vector3.ZERO))
	var roll := offset_near(marks.get("roll", Vector3.ZERO))
	var shots := [
		["01_overview_day", 0, false, roll + 0.6],
		["02_overview_sunset", 0, true, roll + 0.6],
		["03_play_day", 1, false, mega + 0.55],
		["04_play_sunset", 1, true, roll + 0.6],
		["05_mega_loop", 2, false, mega + 0.6],
		["06_loop_sunset", 3, true, loop + 0.62],
		["07_postcard_sunset", 4, true, roll + 0.6],
		["08_ride_day", 5, false, mega + 0.6],
	]
	var only := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--only="):
			only = a.substr(7)
	for s in shots:
		if only != "" and not (s[0] as String).contains(only):
			continue
		_set_time(s[2])
		_set_camera(s[1])
		_place_train(s[3])
		_update_wheel(0.3)
		for i in 8:
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png("res://shots/%s.png" % s[0])
		print("saved ", s[0])
	get_tree().quit()
