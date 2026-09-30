extends Node3D
## Loophole style test. Everything is generated in code: island, sea, puzzle plot,
## coaster, guests. Run normally to play with it, or with `-- --shots` to render
## the comparison screenshots into res://shots/ and quit.
##
## Keys: arrows swipe the tiles, C cycles cameras, T toggles day/sunset.

const TIER_COLORS := [
	Color("#c9c3b5"), Color("#e0b06a"), Color("#7cc45f"), Color("#4fa7dc"),
	Color("#9d74e6"), Color("#ee5d50"), Color("#ff9b45"), Color("#ffd447"),
]
const PLOT_N := 5
const CELL := 1.0
const ISLAND_R := 13.0
const WATER_Y := -2.8
const PLOT_TOP := 0.14
## Deck height of the track above the plot, per tier (Flat .. Mega Loop).
const DECK := [0.45, 0.75, 1.5, 2.2, 1.0, 0.8, 1.0, 1.0]
## Overall size of loops, helixes and corkscrews (1.0 = the original toy scale).
const ELEMENT_SCALE := 1.5

var rng := RandomNumberGenerator.new()
var noise := FastNoiseLite.new()
var materials := {}
var env: Environment
var sun: DirectionalLight3D
var sky_mat: ProceduralSkyMaterial
var cam: Camera3D
var lamps: Array[OmniLight3D] = []
var sunset := false
var cam_mode := 0
var shooting := false

var track_path: Path3D
var cars: Array[PathFollow3D] = []
var train_progress := 0.0

## Puzzle plot: tier per cell (0 = empty), and which cells hold track.
var grid: Array = []
var tile_nodes := {}
var track_cells := {}
var tiles_root: Node3D


func _ready() -> void:
	rng.seed = 11
	noise.seed = 5
	noise.frequency = 0.08
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
	_build_props()
	_build_guests()
	cam = Camera3D.new()
	add_child(cam)
	_set_time(false)
	_set_camera(0)
	if "--shots" in OS.get_cmdline_user_args():
		shooting = true
		_render_shots()


# ---- Drop-in assets -----------------------------------------------------------
# Any model exported to res://assets/models/<name>.glb replaces its procedural
# placeholder. Names are listed in docs/asset-brief.md. Variants like guest_01,
# guest_02... are picked at random.

const MODEL_DIR := "res://assets/models/"
var _variant_cache := {}


func model(name: String, parent: Node3D, pos: Vector3, scale3 := Vector3.ONE, yaw := 0.0) -> Node3D:
	var path := MODEL_DIR + name + ".glb"
	if not ResourceLoader.exists(path):
		return null
	var inst: Node3D = (load(path) as PackedScene).instantiate()
	inst.position = pos
	inst.scale = scale3
	inst.rotation.y = yaw
	parent.add_child(inst)
	return inst


## A random existing variant of `prefix` (prefix_01.glb, prefix_02.glb, ...), or "".
func variant(prefix: String) -> String:
	if not _variant_cache.has(prefix):
		var found: Array[String] = []
		var dir := DirAccess.open(MODEL_DIR)
		if dir:
			for f in dir.get_files():
				var base := f.trim_suffix(".import").trim_suffix(".glb")
				if f.ends_with(".glb") and base.begins_with(prefix + "_"):
					found.append(base)
		_variant_cache[prefix] = found
	var list: Array = _variant_cache[prefix]
	return "" if list.is_empty() else list[rng.randi() % list.size()]


# ---- Helpers -----------------------------------------------------------------

func mat(c: Color, rough := 0.9, metal := 0.0) -> StandardMaterial3D:
	var key := "%s/%s/%s" % [c.to_html(), rough, metal]
	if not materials.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.roughness = rough
		m.metallic = metal
		materials[key] = m
	return materials[key]


func vcol_mat() -> StandardMaterial3D:
	if not materials.has("vcol"):
		var m := StandardMaterial3D.new()
		m.vertex_color_use_as_albedo = true
		m.roughness = 0.95
		materials["vcol"] = m
	return materials["vcol"]


func add_mesh(mesh: Mesh, m: Material, pos: Vector3, parent: Node3D = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = m
	mi.position = pos
	(parent if parent else self).add_child(mi)
	return mi


func box(size: Vector3, c: Color, pos: Vector3, parent: Node3D = null) -> MeshInstance3D:
	var b := BoxMesh.new()
	b.size = size
	return add_mesh(b, mat(c), pos, parent)


func cyl(r_top: float, r_bottom: float, h: float, c: Color, pos: Vector3, sides := 8, parent: Node3D = null) -> MeshInstance3D:
	var m := CylinderMesh.new()
	m.top_radius = r_top
	m.bottom_radius = r_bottom
	m.height = h
	m.radial_segments = sides
	m.rings = 1
	return add_mesh(m, mat(c), pos, parent)


func sphere(r: float, c: Color, pos: Vector3, scale3 := Vector3.ONE, parent: Node3D = null) -> MeshInstance3D:
	var m := SphereMesh.new()
	m.radius = r
	m.height = r * 2.0
	m.radial_segments = 8
	m.rings = 5
	var mi := add_mesh(m, mat(c), pos, parent)
	mi.scale = scale3
	return mi


func cell_pos(c: Vector2i) -> Vector3:
	return Vector3((c.x - 2) * CELL, PLOT_TOP, (c.y - 2) * CELL)


func jitter(c: Color, amount := 0.05) -> Color:
	return Color(
		clampf(c.r + rng.randf_range(-amount, amount), 0.0, 1.0),
		clampf(c.g + rng.randf_range(-amount, amount), 0.0, 1.0),
		clampf(c.b + rng.randf_range(-amount, amount), 0.0, 1.0))


# ---- Environment -------------------------------------------------------------

func _build_environment() -> void:
	var we := WorldEnvironment.new()
	env = Environment.new()
	sky_mat = ProceduralSkyMaterial.new()
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.05
	env.ssao_enabled = true
	env.ssao_radius = 0.6
	env.ssao_intensity = 1.6
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_bloom = 0.05
	env.fog_enabled = true
	env.fog_sky_affect = 0.2
	if "fog_mode" in env:
		# Depth fog (Godot 4.3+): haze on the distant mountains only.
		env.set("fog_mode", 1)
		env.set("fog_depth_begin", 60.0)
		env.set("fog_depth_end", 140.0)
		env.fog_density = 0.8
	else:
		env.fog_density = 0.0015
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.28
	env.adjustment_contrast = 1.05
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 70.0
	sun.shadow_blur = 1.5
	add_child(sun)


func _set_time(evening: bool) -> void:
	sunset = evening
	if evening:
		sun.rotation_degrees = Vector3(-16, 58, 0)
		sun.light_color = Color(1.0, 0.68, 0.42)
		sun.light_energy = 1.35
		sky_mat.sky_top_color = Color("#3d4a8a")
		sky_mat.sky_horizon_color = Color("#f4a06a")
		sky_mat.ground_horizon_color = Color("#d98a63")
		sky_mat.ground_bottom_color = Color("#2d3060")
		env.fog_light_color = Color("#e59a78")
		env.ambient_light_energy = 0.7
	else:
		sun.rotation_degrees = Vector3(-48, 38, 0)
		sun.light_color = Color(1.0, 0.95, 0.86)
		sun.light_energy = 1.25
		sky_mat.sky_top_color = Color("#4a86c8")
		sky_mat.sky_horizon_color = Color("#bfe0f0")
		sky_mat.ground_horizon_color = Color("#a8cfe0")
		sky_mat.ground_bottom_color = Color("#3b6d8f")
		env.fog_light_color = Color("#bcd8ea")
		env.ambient_light_energy = 0.9
	for l in lamps:
		l.light_energy = 1.6 if evening else 0.0


# ---- Island ------------------------------------------------------------------

func island_radius(theta: float) -> float:
	return ISLAND_R * (1.0 + 0.1 * sin(3.0 * theta + 1.3) + 0.06 * sin(7.0 * theta + 0.4) + 0.03 * sin(13.0 * theta))


func island_height(p: Vector2) -> float:
	var d := p.length()
	if d < 8.0:
		return 0.0
	var t := minf(1.0, (d - 8.0) / 2.0)
	return (0.25 + noise.get_noise_2d(p.x * 3.0, p.y * 3.0) * 0.6) * t


func _build_island() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 22
	var segs := 120
	var grass := [Color("#6fb84a"), Color("#63a944"), Color("#7cc453"), Color("#5b9e40")]
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
			var col: Color = grass[int(absf(noise.get_noise_2d(a.x * 5.0, a.z * 5.0)) * 8.0) % grass.size()]
			if k == rings - 1:
				col = col.darkened(0.12)
			for v in [a, b, c, a, c, d]:
				st.set_color(col)
				st.add_vertex(v)
	# Cliffs: rock strata down into the sea.
	var strata := [Color("#a47a55"), Color("#8b6a4f"), Color("#b58a5e"), Color("#7a5d48"), Color("#6a5a55")]
	var bands := 7
	for m in segs:
		var th0 := TAU * m / segs
		var th1 := TAU * (m + 1) / segs
		for j in bands:
			var f0 := float(j) / bands
			var f1 := float(j + 1) / bands
			var pts := []
			for th in [th0, th1]:
				for f in [f0, f1]:
					var r: float = island_radius(th) * (1.0 - 0.08 * f + 0.03 * noise.get_noise_2d(th * 20.0, f * 5.0))
					var top_y: float = island_height(Vector2(cos(th), sin(th)) * island_radius(th))
					var y: float = lerpf(top_y, WATER_Y - 0.6, f)
					pts.append(Vector3(cos(th) * r, y, sin(th) * r))
			var col: Color = strata[(j + int(noise.get_noise_2d(m * 0.5, j) * 3.0 + 3.0)) % strata.size()]
			for v in [pts[0], pts[1], pts[3], pts[0], pts[3], pts[2]]:
				st.set_color(col)
				st.add_vertex(v)
	st.generate_normals()
	add_mesh(st.commit(), vcol_mat(), Vector3.ZERO)


func _build_water() -> void:
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode specular_schlick_ggx, cull_disabled;
uniform vec3 deep : source_color = vec3(0.10, 0.36, 0.62);
uniform vec3 shallow : source_color = vec3(0.30, 0.74, 0.82);
uniform float island_r = 13.0;
varying vec3 world;
void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	VERTEX.y += sin(world.x * 0.7 + TIME * 1.1) * 0.04 + cos(world.z * 0.6 + TIME * 0.9) * 0.04;
}
void fragment() {
	float d = length(world.xz);
	float near = clamp(1.0 - (d - island_r) / 6.0, 0.0, 1.0);
	ALBEDO = mix(deep, shallow, near * near);
	float w = sin(world.x * 1.7 + TIME * 1.3) + cos(world.z * 1.9 - TIME * 1.1) + sin((world.x + world.z) * 2.3 + TIME);
	NORMAL = normalize(NORMAL + vec3(0.06 * cos(world.x * 1.7 + TIME), 0.0, 0.06 * sin(world.z * 1.9 - TIME)));
	ROUGHNESS = 0.08;
	SPECULAR = 0.7;
	EMISSION = vec3(0.9, 0.95, 1.0) * smoothstep(2.4, 2.9, w) * 0.15;
}
"""
	var sm := ShaderMaterial.new()
	sm.shader = sh
	var plane := PlaneMesh.new()
	plane.size = Vector2(160, 160)
	plane.subdivide_width = 80
	plane.subdivide_depth = 80
	add_mesh(plane, sm, Vector3(0, WATER_Y, 0))
	# White foam where the sea meets the cliffs.
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var segs := 160
	for m in segs:
		var pts := []
		for th in [TAU * m / segs, TAU * (m + 1) / segs]:
			var r := island_radius(th)
			for off in [-0.1, 0.45 + 0.2 * sin(th * 9.0)]:
				pts.append(Vector3(cos(th) * (r * 0.97 + off), WATER_Y + 0.05, sin(th) * (r * 0.97 + off)))
		for v in [pts[0], pts[1], pts[3], pts[0], pts[3], pts[2]]:
			st.add_vertex(v)
	st.generate_normals()
	var foam := StandardMaterial3D.new()
	foam.albedo_color = Color(1, 1, 1, 0.75)
	foam.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	foam.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	add_mesh(st.commit(), foam, Vector3.ZERO)


func _build_waterfall() -> void:
	var th := 1.25
	var r := island_radius(th)
	var dir := Vector3(cos(th), 0, sin(th))
	var side := dir.cross(Vector3.UP)
	var top := dir * (r - 2.5) + Vector3(0, island_height(Vector2(dir.x, dir.z) * (r - 2.5)) + 0.02, 0)
	# Stream across the grass.
	for k in 6:
		var p := dir * (r - 2.6 + k * 0.45)
		var b := box(Vector3(0.55, 0.05, 0.5), Color("#5cc8f0"), Vector3(p.x, island_height(Vector2(p.x, p.z)) + 0.03, p.z))
		b.rotation.y = -th
	# The fall: a sheet of animated water down the cliff.
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode unshaded, cull_disabled;
void fragment() {
	float streak = fract(UV.y * 3.0 - TIME * 1.6 + sin(UV.x * 40.0) * 0.15);
	vec3 c = mix(vec3(0.55, 0.85, 0.97), vec3(1.0), smoothstep(0.6, 1.0, streak));
	ALBEDO = c;
	ALPHA = 0.85;
}
"""
	var sm := ShaderMaterial.new()
	sm.shader = sh
	var q := QuadMesh.new()
	q.size = Vector2(0.6, top.y - WATER_Y)
	var fall := add_mesh(q, sm, dir * (r + 0.05) + Vector3(0, (top.y + WATER_Y) / 2.0, 0))
	fall.look_at(fall.position + dir, Vector3.UP)
	# Splash at the bottom.
	for k in 7:
		sphere(rng.randf_range(0.12, 0.22), Color("#ffffff"), dir * (r + 0.3) + side * rng.randf_range(-0.35, 0.35) + Vector3(0, WATER_Y + 0.05, 0), Vector3(1.0, 0.5, 1.0))


func _build_backdrop() -> void:
	# Distant mountains that the fog softens.
	for i in 22:
		var th := rng.randf_range(-2.4, 0.9)
		var d := rng.randf_range(50.0, 75.0)
		var h := rng.randf_range(10.0, 24.0)
		var pos := Vector3(cos(th) * d, WATER_Y + h / 2.0 - 1.0, sin(th) * d)
		var c := jitter(Color("#6b87a8"), 0.06)
		cyl(0.0, h * 0.75, h, c, pos, 7)
		if h > 16.0:
			cyl(0.0, h * 0.2, h * 0.28, Color("#eef3f8"), pos + Vector3(0, h * 0.36, 0), 7)
	# A couple of small islets.
	for p in [Vector3(-20, WATER_Y, 8), Vector3(18, WATER_Y, -14)]:
		cyl(2.0, 2.6, 1.6, Color("#8b6a4f"), p, 9)
		for k in 4:
			_tree(p + Vector3(rng.randf_range(-1.2, 1.2), 0.8, rng.randf_range(-1.2, 1.2)))


# ---- Park --------------------------------------------------------------------

func _build_plaza() -> void:
	var plaza := CylinderMesh.new()
	plaza.top_radius = 7.2
	plaza.bottom_radius = 7.2
	plaza.height = 0.1
	plaza.radial_segments = 48
	add_mesh(plaza, mat(Color("#e3cfa6")), Vector3(0, -0.02, 0))
	# Paving flecks.
	for i in 260:
		var th := rng.randf() * TAU
		var r := sqrt(rng.randf()) * 7.0
		box(Vector3(0.28, 0.02, 0.28), jitter(Color("#d6bf94"), 0.04), Vector3(cos(th) * r, 0.035, sin(th) * r))
	# Paths out to the island edge.
	for th in [0.4, 2.3, 4.1]:
		var dir := Vector3(cos(th), 0, sin(th))
		for s in range(7, 13):
			var b := box(Vector3(1.3, 0.08, 1.05), Color("#dcc596"), dir * s + Vector3(0, island_height(Vector2(dir.x, dir.z) * s) + 0.02, 0))
			b.rotation.y = -th


func _build_plot() -> void:
	# Raised plot with a stone rim and a checkered lawn.
	box(Vector3(PLOT_N + 0.5, 0.28, PLOT_N + 0.5), Color("#b7a58a"), Vector3(0, 0.0, 0))
	for y in PLOT_N:
		for x in PLOT_N:
			var c := Color("#8ccb63") if (x + y) % 2 == 0 else Color("#7dbd57")
			box(Vector3(0.98, 0.04, 0.98), c, cell_pos(Vector2i(x, y)) + Vector3(0, 0.0, 0))
	tiles_root = Node3D.new()
	add_child(tiles_root)
	grid = []
	for y in PLOT_N:
		var row := []
		for x in PLOT_N:
			row.append(0)
		grid.append(row)
	for c in TRACK:
		track_cells[c[0]] = c[1]
	var weights := [0, 5, 4, 3, 2, 1, 1, 1]
	for y in PLOT_N:
		for x in PLOT_N:
			var v := Vector2i(x, y)
			if track_cells.has(v) or rng.randf() < 0.3:
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


func _tile(tier: int) -> Node3D:
	var n := Node3D.new()
	if model("tile_%d" % tier, n, Vector3.ZERO):
		return n
	var col: Color = TIER_COLORS[tier]
	box(Vector3(0.84, 0.2, 0.84), col, Vector3(0, 0.1, 0), n)
	box(Vector3(0.78, 0.04, 0.78), col.lightened(0.18), Vector3(0, 0.215, 0), n)
	var ic := col.lightened(0.55)
	match tier:
		1:
			sphere(0.16, ic, Vector3(0, 0.23, 0), Vector3(1.4, 0.55, 1.0), n)
		2:
			sphere(0.2, ic, Vector3(0, 0.24, 0), Vector3(1.3, 1.0, 1.0), n)
		3:
			var p := PrismMesh.new()
			p.size = Vector3(0.44, 0.34, 0.3)
			p.left_to_right = 0.0
			add_mesh(p, mat(ic), Vector3(0, 0.4, 0), n)
		4:
			for k in 2:
				var t := TorusMesh.new()
				t.inner_radius = 0.1
				t.outer_radius = 0.17
				add_mesh(t, mat(ic), Vector3(0, 0.26 + k * 0.08, 0), n)
		5, 7:
			var t := TorusMesh.new()
			var s := 1.0 if tier == 5 else 1.35
			t.inner_radius = 0.13 * s
			t.outer_radius = 0.19 * s
			var mi := add_mesh(t, mat(ic if tier == 5 else Color("#fff6c8")), Vector3(0, 0.24 + 0.19 * s, 0), n)
			mi.rotation_degrees = Vector3(90, 0, 0)
		6:
			for k in 2:
				var t := TorusMesh.new()
				t.inner_radius = 0.08
				t.outer_radius = 0.13
				var mi := add_mesh(t, mat(ic), Vector3(-0.12 + k * 0.24, 0.37, 0), n)
				mi.rotation_degrees = Vector3(90, 0, 25)
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
	var lanes := range(PLOT_N)
	for lane in lanes:
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

## The ride, as built on the plot: cell and piece tier, from the platform's left
## side up and around, back down into its right side.
const TRACK := [
	[Vector2i(1, 4), 1], [Vector2i(1, 3), 2], [Vector2i(1, 2), 5], [Vector2i(1, 1), 3],
	[Vector2i(1, 0), 4], [Vector2i(2, 0), 2], [Vector2i(3, 0), 3], [Vector2i(3, 1), 6],
	[Vector2i(3, 2), 7], [Vector2i(3, 3), 2], [Vector2i(2, 3), 1], [Vector2i(2, 4), 0],
]


func _build_coaster() -> void:
	var pts: Array[Vector3] = []
	var st0 := cell_pos(Vector2i(1, 5)) + Vector3(0, 0.35, 0)
	var st1 := cell_pos(Vector2i(2, 5)) + Vector3(0, 0.35, 0)
	pts.append(st0)
	var prev := st0
	for i in TRACK.size():
		var c: Vector2i = TRACK[i][0]
		var tier: int = TRACK[i][1]
		var base := cell_pos(c) + Vector3(0, DECK[tier], 0)
		var fwd := Vector3(base.x - prev.x, 0, base.z - prev.z).normalized()
		var right := fwd.cross(Vector3.UP).normalized()
		match tier:
			5, 7:
				# Vertical loop in the direction of travel, drifting sideways so it doesn't collide.
				var r := (0.55 if tier == 5 else 0.75) * ELEMENT_SCALE
				var start := base - fwd * 0.35 * ELEMENT_SCALE
				pts.append(start)
				for k in range(1, 12):
					var a := TAU * k / 12.0
					pts.append(start + Vector3(0, r, 0) + fwd * sin(a) * r - Vector3(0, cos(a) * r, 0) + right * (k / 12.0 - 0.5) * 0.24)
				pts.append(start + fwd * 0.4 * ELEMENT_SCALE + right * 0.12)
			4:
				# Helix: one rising turn around the cell center.
				for k in 8:
					var a := TAU * k / 8.0
					pts.append(base + (fwd * sin(a) + right * (1.0 - cos(a))) * 0.3 * ELEMENT_SCALE + Vector3(0, k * 0.08, 0))
			6:
				# Corkscrew: a roll along the direction of travel.
				for k in 7:
					var a := TAU * k / 6.0
					pts.append(base + fwd * (-0.35 + 0.7 * k / 6.0) + (right * sin(a) + Vector3(0, 1.0 - cos(a), 0)) * 0.22 * ELEMENT_SCALE)
			_:
				pts.append(base)
		prev = pts[pts.size() - 1]
	pts.append(st1)
	# Back along the platform to close the circuit.
	pts.append(st1 + (st0 - st1) * 0.5 + Vector3(0, 0, 0.05))

	var curve := Curve3D.new()
	curve.bake_interval = 0.04
	curve.up_vector_enabled = true
	var n := pts.size()
	for i in n:
		var a := pts[(i - 1 + n) % n]
		var b := pts[(i + 1) % n]
		var h := (b - a) * 0.22
		curve.add_point(pts[i], -h, h)
	curve.add_point(pts[0], -(pts[1] - pts[n - 1]) * 0.2, (pts[1] - pts[n - 1]) * 0.2)
	track_path = Path3D.new()
	track_path.curve = curve
	add_child(track_path)
	_build_track_mesh(curve)
	_build_train()


func _frame(curve: Curve3D, o: float) -> Array:
	var total := curve.get_baked_length()
	var p := curve.sample_baked(fmod(o, total), true)
	var q := curve.sample_baked(fmod(o + 0.03, total), true)
	var fwd := (q - p).normalized()
	var up := curve.sample_baked_up_vector(fmod(o, total), true)
	var right := fwd.cross(up).normalized()
	up = right.cross(fwd).normalized()
	return [p, fwd, up, right]


func _tube(st: SurfaceTool, rings: Array, col: Color) -> void:
	for i in rings.size() - 1:
		var a: Array = rings[i]
		var b: Array = rings[i + 1]
		for k in a.size():
			var k2 := (k + 1) % a.size()
			for v in [a[k], b[k], b[k2], a[k], b[k2], a[k2]]:
				st.set_color(col)
				st.add_vertex(v)


func _oriented_box(st: SurfaceTool, c: Vector3, x: Vector3, y: Vector3, z: Vector3, col: Color) -> void:
	var corners := []
	for sx in [-1, 1]:
		for sy in [-1, 1]:
			for sz in [-1, 1]:
				corners.append(c + x * sx + y * sy + z * sz)
	var faces := [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
	for f in faces:
		for idx in [f[0], f[1], f[2], f[0], f[2], f[3]]:
			st.set_color(col)
			st.add_vertex(corners[idx])


func _build_track_mesh(curve: Curve3D) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var total := curve.get_baked_length()
	var step := 0.05
	var rails := [[], []]
	var spine := []
	var o := 0.0
	var i := 0
	var supports := []
	while o <= total + 0.001:
		var f := _frame(curve, o)
		var p: Vector3 = f[0]
		var fwd: Vector3 = f[1]
		var up: Vector3 = f[2]
		var right: Vector3 = f[3]
		for s in 2:
			var c: Vector3 = p + right * (0.12 if s == 0 else -0.12) + up * 0.03
			var ring := []
			for k in 6:
				var a := TAU * k / 6.0
				ring.append(c + (right * cos(a) + up * sin(a)) * 0.032)
			rails[s].append(ring)
		var sp := []
		for k in 6:
			var a := TAU * k / 6.0
			sp.append(p - up * 0.05 + (right * cos(a) + up * sin(a)) * 0.045)
		spine.append(sp)
		if i % 3 == 0:
			_oriented_box(st, p - up * 0.01, right * 0.155, up * 0.018, fwd * 0.026, Color("#5b3f2e"))
		if i % 8 == 0 and up.y > 0.7 and p.y > PLOT_TOP + 0.25:
			supports.append(p - up * 0.07)
		o += step
		i += 1
	_tube(st, rails[0], Color("#e34a3c"))
	_tube(st, rails[1], Color("#e34a3c"))
	_tube(st, spine, Color("#f3efe6"))
	# Supports: timber posts down to the plot.
	for s in supports:
		var h: float = s.y - PLOT_TOP
		_oriented_box(st, Vector3(s.x, PLOT_TOP + h / 2.0, s.z), Vector3(0.035, 0, 0), Vector3(0, h / 2.0, 0), Vector3(0, 0, 0.035), Color("#8a6038"))
	st.generate_normals()
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 0.55
	add_mesh(st.commit(), m, Vector3.ZERO)


func _build_train() -> void:
	var shirts := [Color("#f0584e"), Color("#45a8e0"), Color("#ffd23f"), Color("#72c457"), Color("#9d6ef0"), Color("#ff8fb8")]
	for k in 4:
		var pf := PathFollow3D.new()
		pf.rotation_mode = PathFollow3D.ROTATION_ORIENTED
		pf.use_model_front = false
		pf.loop = true
		track_path.add_child(pf)
		var car := Node3D.new()
		pf.add_child(car)
		if not model("coaster_car", car, Vector3.ZERO):
			box(Vector3(0.26, 0.1, 0.3), Color("#e34a3c"), Vector3(0, 0.1, 0), car)
			box(Vector3(0.27, 0.03, 0.31), Color("#ffd23f"), Vector3(0, 0.07, 0), car)
		for side in [-0.06, 0.06]:
			sphere(0.045, Color("#f2c9a5"), Vector3(side, 0.21, 0), Vector3.ONE, car)
			sphere(0.03, shirts[rng.randi() % shirts.size()], Vector3(side, 0.16, 0), Vector3(1.4, 1.0, 1.0), car)
		cars.append(pf)
	_place_train(9.0)


func _place_train(progress: float) -> void:
	train_progress = progress
	for k in cars.size():
		cars[k].progress = progress - k * 0.34


# ---- Station, trees, props, guests ------------------------------------------

func _build_station() -> void:
	var c := (cell_pos(Vector2i(1, 5)) + cell_pos(Vector2i(2, 5))) / 2.0 + Vector3(0, 0, 0.15)
	if model("station", self, c):
		return
	box(Vector3(2.2, 0.3, 0.9), Color("#c8c4bd"), c + Vector3(0, 0.12, 0))
	box(Vector3(2.2, 0.02, 0.06), Color("#ffd23f"), c + Vector3(0, 0.28, 0.4))
	for x in [-1.0, 0.0, 1.0]:
		cyl(0.035, 0.035, 0.75, Color("#3b2f4a"), c + Vector3(x, 0.62, 0.38), 6)
	# Striped canopy over the front half of the platform only, so the board stays visible.
	for k in 11:
		var col := Color("#e8484f") if k % 2 == 0 else Color("#fbf6ec")
		var stripe := box(Vector3(0.2, 0.04, 0.5), col, c + Vector3(-1.0 + k * 0.2, 1.0, 0.3))
		stripe.rotation_degrees = Vector3(-14, 0, 0)
	box(Vector3(0.8, 0.22, 0.05), Color("#ffd23f"), c + Vector3(0, 1.16, 0.56))


func _tree(pos: Vector3) -> void:
	var autumn := [Color("#e8883a"), Color("#d9542f"), Color("#f2b33d"), Color("#b8472e")]
	var green := [Color("#3f8a4a"), Color("#4f9e4f"), Color("#2f6f45"), Color("#5aa653")]
	var s := rng.randf_range(0.8, 1.3)
	var pine := rng.randf() < 0.45
	var drop_in := variant("tree_pine" if pine else "tree_round")
	if drop_in != "" and model(drop_in, self, pos, Vector3.ONE * s, rng.randf() * TAU):
		return
	if pine:
		# Pine.
		cyl(0.06 * s, 0.08 * s, 0.4 * s, Color("#6b4428"), pos + Vector3(0, 0.2 * s, 0), 5)
		var c: Color = jitter(green[rng.randi() % green.size()], 0.03)
		for k in 3:
			cyl(0.0, (0.55 - k * 0.12) * s, 0.6 * s, c.lightened(k * 0.05), pos + Vector3(0, (0.55 + k * 0.32) * s, 0), 7)
	else:
		# Round deciduous tree, often in autumn colors.
		cyl(0.06 * s, 0.09 * s, 0.6 * s, Color("#6b4428"), pos + Vector3(0, 0.3 * s, 0), 5)
		var pal: Array = autumn if rng.randf() < 0.55 else green
		var c: Color = jitter(pal[rng.randi() % pal.size()], 0.04)
		sphere(0.45 * s, c, pos + Vector3(0, 0.95 * s, 0), Vector3(1.0, 0.9, 1.0))
		sphere(0.3 * s, c.lightened(0.08), pos + Vector3(0.2 * s, 1.2 * s, 0.1 * s))


func _build_trees() -> void:
	var placed := 0
	var tries := 0
	while placed < 170 and tries < 3000:
		tries += 1
		var th := rng.randf() * TAU
		var r := rng.randf_range(7.6, island_radius(th) - 0.6)
		var p := Vector2(cos(th), sin(th)) * r
		# Keep the paths clear.
		var on_path := false
		for pth in [0.4, 2.3, 4.1]:
			if absf(wrapf(th - pth, -PI, PI)) < 0.12:
				on_path = true
		if on_path:
			continue
		_tree(Vector3(p.x, island_height(p), p.y))
		placed += 1
	# A few inside the plaza for shade.
	for p in [Vector3(-5.5, 0, 2.5), Vector3(5.2, 0, 3.4), Vector3(-4.5, 0, -5.0), Vector3(6.0, 0, -3.0)]:
		_tree(p)


func _build_props() -> void:
	# Carousel.
	var cp := Vector3(-4.6, 0, -1.6)
	var fp := Vector3(4.8, 0, 0.8)
	_build_carousel(cp)
	if not model("food_stand", self, fp):
		_build_food_stand(fp)
	_build_lamps_and_dressing()


func _build_carousel(cp: Vector3) -> void:
	if model("carousel", self, cp):
		return
	cyl(1.0, 1.05, 0.18, Color("#e8d8b8"), cp + Vector3(0, 0.09, 0), 16)
	cyl(0.06, 0.06, 1.2, Color("#ffd23f"), cp + Vector3(0, 0.7, 0), 8)
	for k in 8:
		var a := TAU * k / 8.0
		cyl(0.02, 0.02, 0.9, Color("#e0c070"), cp + Vector3(cos(a) * 0.75, 0.6, sin(a) * 0.75), 4)
		sphere(0.1, [Color("#ffffff"), Color("#f7c9a0")][k % 2], cp + Vector3(cos(a) * 0.75, 0.45, sin(a) * 0.75), Vector3(1.6, 1.0, 0.8))
	cyl(0.0, 1.25, 0.6, Color("#e8484f"), cp + Vector3(0, 1.5, 0), 16)
	cyl(0.9, 1.26, 0.08, Color("#fbf6ec"), cp + Vector3(0, 1.22, 0), 16)
	sphere(0.08, Color("#ffd23f"), cp + Vector3(0, 1.85, 0))


func _build_food_stand(fp: Vector3) -> void:
	box(Vector3(1.1, 0.8, 0.8), Color("#fbf6ec"), fp + Vector3(0, 0.4, 0))
	box(Vector3(0.9, 0.25, 0.05), Color("#3b2f4a"), fp + Vector3(0, 0.55, 0.41))
	for k in 6:
		var stripe := box(Vector3(0.2, 0.05, 0.6), Color("#e8484f") if k % 2 == 0 else Color("#fbf6ec"), fp + Vector3(-0.5 + k * 0.2, 0.95, 0.55))
		stripe.rotation_degrees = Vector3(20, 0, 0)
	box(Vector3(0.5, 0.18, 0.05), Color("#ffd23f"), fp + Vector3(0, 1.2, 0.3))


func _build_lamps_and_dressing() -> void:
	# Lamps around the plaza.
	for k in 8:
		var a := TAU * k / 8.0 + 0.2
		var lp := Vector3(cos(a) * 6.6, 0, sin(a) * 6.6)
		cyl(0.03, 0.04, 1.1, Color("#2f2940"), lp + Vector3(0, 0.55, 0), 6)
		sphere(0.08, Color("#fff1b0"), lp + Vector3(0, 1.15, 0))
		var light := OmniLight3D.new()
		light.position = lp + Vector3(0, 1.1, 0)
		light.light_color = Color("#ffcf80")
		light.omni_range = 2.8
		light.light_energy = 0.0
		add_child(light)
		lamps.append(light)
	# Benches and flower beds.
	for p in [Vector3(-2.8, 0, 4.6), Vector3(3.2, 0, 4.4), Vector3(-6.0, 0, 0.8)]:
		box(Vector3(0.7, 0.06, 0.22), Color("#9a6a3e"), p + Vector3(0, 0.22, 0))
		box(Vector3(0.7, 0.2, 0.05), Color("#9a6a3e"), p + Vector3(0, 0.33, -0.1))
	for i in 60:
		var th := rng.randf() * TAU
		var r := rng.randf_range(7.2, 7.8)
		sphere(0.07, [Color("#ff5d8a"), Color("#ffd23f"), Color("#ffffff"), Color("#9d6ef0")][i % 4], Vector3(cos(th) * r, 0.08, sin(th) * r))


func _peep(pos: Vector3, big := false) -> void:
	var skins := [Color("#fbd9bd"), Color("#eab893"), Color("#c98d63"), Color("#95603f"), Color("#63402b")]
	var shirts := [Color("#f0584e"), Color("#45a8e0"), Color("#72c457"), Color("#ffd23f"), Color("#9d6ef0"), Color("#ff9a3c"), Color("#ff8fb8"), Color("#35c2b0")]
	var hairs := [Color("#3a2718"), Color("#6b4428"), Color("#b0602e"), Color("#e8bf5a"), Color("#e4e4ec"), Color("#232338")]
	var s := 1.9 if big else rng.randf_range(0.9, 1.05)
	var drop_in := "boss_barry" if big else variant("guest")
	if drop_in != "" and model(drop_in, self, pos, Vector3.ONE, rng.randf() * TAU):
		return
	var n := Node3D.new()
	n.position = pos
	n.rotation.y = rng.randf() * TAU
	n.scale = Vector3.ONE * s
	add_child(n)
	cyl(0.035, 0.035, 0.14, Color("#3a4a7a"), Vector3(0, 0.07, 0), 6, n)
	var body := CapsuleMesh.new()
	body.radius = 0.065
	body.height = 0.2
	body.radial_segments = 8
	body.rings = 2
	add_mesh(body, mat(shirts[rng.randi() % shirts.size()]), Vector3(0, 0.22, 0), n)
	sphere(0.06, skins[rng.randi() % skins.size()], Vector3(0, 0.37, 0), Vector3.ONE, n)
	sphere(0.062, hairs[rng.randi() % hairs.size()], Vector3(0, 0.395, -0.01), Vector3(1.0, 0.6, 1.0), n)


func _build_guests() -> void:
	# The queue under the platform, with the boss (Big Barry) at the front.
	var c := (cell_pos(Vector2i(1, 5)) + cell_pos(Vector2i(2, 5))) / 2.0
	_peep(c + Vector3(-0.9, 0, 1.25), true)
	for k in 9:
		_peep(c + Vector3(-0.3 + k * 0.32, 0, 1.35 + (k % 2) * 0.08))
	# Guests milling about the plaza.
	var placed := 0
	while placed < 40:
		var th := rng.randf() * TAU
		var r := rng.randf_range(3.6, 6.8)
		var p := Vector3(cos(th) * r, 0, sin(th) * r)
		if p.distance_to(Vector3(-4.6, 0, -1.6)) < 1.3 or p.distance_to(Vector3(4.8, 0, 0.8)) < 0.9:
			continue
		_peep(p)
		placed += 1


# ---- Camera, input, screenshots ----------------------------------------------

const CAMERAS := 7
## Phone camera turn in degrees. 0 keeps the grid square-on, but loops that run
## up or down a column are then seen edge-on.
var PHONE_YAW := 20.0


func _set_camera(mode: int) -> void:
	cam_mode = mode
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	var target := Vector3(0, 0.2, 0.6)
	match mode:
		3:
			# Gameplay, isometric: the plot fills most of the view.
			cam.projection = Camera3D.PROJECTION_ORTHOGONAL
			cam.size = 9.5
			var yaw := deg_to_rad(45.0)
			var pitch := deg_to_rad(38.0)
			var t := Vector3(0, 0.4, 0.5)
			cam.position = t + Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * 30.0
			cam.look_at(t)
		4:
			# Gameplay, square-on: every swipe maps straight onto the grid.
			cam.projection = Camera3D.PROJECTION_ORTHOGONAL
			cam.size = 8.6
			var pitch := deg_to_rad(55.0)
			var t := Vector3(0, 0.4, 0.8)
			cam.position = t + Vector3(0, sin(pitch), cos(pitch)) * 30.0
			cam.look_at(t)
		0:
			# Overview, isometric: the plot reads as a diamond, like the mockup.
			cam.projection = Camera3D.PROJECTION_ORTHOGONAL
			cam.size = 24.0
			var yaw := deg_to_rad(45.0)
			var pitch := deg_to_rad(33.0)
			cam.position = target + Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * 30.0
			cam.look_at(target)
		1:
			# Square-on 3/4 view: swipes map straight to the grid.
			cam.projection = Camera3D.PROJECTION_ORTHOGONAL
			cam.size = 17.0
			var pitch := deg_to_rad(52.0)
			cam.position = target + Vector3(0, sin(pitch), cos(pitch)) * 30.0
			cam.look_at(target)
		2:
			# Close-up on the ride.
			cam.projection = Camera3D.PROJECTION_PERSPECTIVE
			cam.fov = 38.0
			cam.position = Vector3(3.8, 2.4, 4.6)
			cam.look_at(Vector3(0.6, 0.9, -0.4))
		6:
			# Phone portrait: the plot spans almost the full width; the park frames it
			# above, the station and the queue sit below it.
			cam.projection = Camera3D.PROJECTION_ORTHOGONAL
			cam.keep_aspect = Camera3D.KEEP_WIDTH
			var pitch := deg_to_rad(40.0)
			var yaw := deg_to_rad(PHONE_YAW)
			cam.size = maxf(6.4, 5.5 * (cos(yaw) + sin(yaw)))
			var t := Vector3(0, 0.6, 0.6)
			cam.position = t + Vector3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * 30.0
			cam.look_at(t)
		5:
			# Mood framing (docs/mood/coaster_town_mood.png): square-on and steep, the
			# plot upper-center, the park around it and the island edge at the bottom.
			cam.projection = Camera3D.PROJECTION_ORTHOGONAL
			cam.size = 12.5
			var pitch := deg_to_rad(50.0)
			var t := Vector3(0, 0.2, 1.4)
			cam.position = t + Vector3(0, sin(pitch), cos(pitch)) * 30.0
			cam.look_at(t)


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


func _process(delta: float) -> void:
	if shooting or cars.is_empty():
		return
	_place_train(train_progress + delta * 1.6)


func _render_shots() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://shots"))
	var shots := [
		["01_overview_day", 0, false, 9.0],
		["02_overview_sunset", 0, true, 9.0],
		["03_play_iso_day", 3, false, 9.0],
		["04_play_square_day", 4, false, 9.0],
		["05_play_square_sunset", 4, true, 9.0],
		["06_ride_closeup", 2, true, 5.6],
		["07_mood_square_day", 5, false, 9.0],
		["08_phone_day", 6, false, 9.0, Vector2i(720, 1280)],
		["09_phone_sunset", 6, true, 9.0, Vector2i(720, 1280)],
	]
	if "--phone-yaw" in OS.get_cmdline_user_args():
		PHONE_YAW = float(OS.get_cmdline_user_args()[OS.get_cmdline_user_args().find("--phone-yaw") + 1])
	for s in shots:
		var size: Vector2i = s[4] if s.size() > 4 else Vector2i(1600, 1000)
		if get_window().size != size:
			get_window().size = size
		_set_time(s[2])
		_set_camera(s[1])
		_place_train(s[3])
		for i in 6:
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png("res://shots/%s.png" % s[0])
		print("saved ", s[0])
	get_tree().quit()
