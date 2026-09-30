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
var cars: Array[Node3D] = []
var train_progress := 0.0

## Puzzle plot: tier per cell (0 = empty), and which cells hold track.
var grid: Array = []
var tile_nodes := {}
var track_cells := {}
var tiles_root: Node3D
## Nodes that move or change during play (tiles, coaster, station, guests). The painted
## plate replaces everything else.
var dynamic_nodes: Array[Node] = []


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
	dynamic_nodes.append(tiles_root)
	var n0 := get_child_count()
	_build_coaster()
	_build_station()
	_mark_dynamic(n0)
	_build_trees()
	_build_props()
	n0 = get_child_count()
	_build_guests()
	_mark_dynamic(n0)
	cam = Camera3D.new()
	add_child(cam)
	_set_time(false)
	_set_camera(0)
	var args := OS.get_cmdline_user_args()
	if "--plate" in args:
		_use_plate(args[args.find("--plate") + 1])
		# The plate is painted for the phone camera at 9:16; open straight into it.
		get_window().size = Vector2i(720, 1280)
		get_window().move_to_center()
		_set_camera(6)
	if "--ride-check" in args:
		_ride_check()
		get_tree().quit()
		return
	if "--plate-source" in args:
		shooting = true
		_render_plate_source()
	elif "--shots" in args:
		shooting = true
		_render_shots()


func _mark_dynamic(from_index: int) -> void:
	for i in range(from_index, get_child_count()):
		dynamic_nodes.append(get_child(i))


func _is_dynamic(n: Node) -> bool:
	for d in dynamic_nodes:
		if d == n or d.is_ancestor_of(n):
			return true
	return false


# ---- Painted plate -------------------------------------------------------------
# For the fixed phone camera, the static park can be a painting (made from a render
# of this scene, see docs/asset-brief.md). The low-poly park stays as an invisible
# stand-in that shows the painting, keeps depth and receives shadows.

var plate_mode := false


func _use_plate(path: String) -> void:
	var tex: Texture2D = load(path) if path.begins_with("res://") else ImageTexture.create_from_image(Image.load_from_file(path))
	var m := ShaderMaterial.new()
	m.shader = load("res://plate.gdshader")
	m.set_shader_parameter("plate", tex)
	var sway_path := path.replace(".png", "_sway.png")
	if ResourceLoader.exists(sway_path):
		m.set_shader_parameter("sway_mask", load(sway_path))
	var stack: Array[Node] = [self]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n != self and _is_dynamic(n):
			continue
		if n is GeometryInstance3D:
			(n as GeometryInstance3D).material_override = m
			(n as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		stack.append_array(n.get_children())
	# Show the painting as painted: no tonemapping, grading or glow on top of it.
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure = 1.0
	env.adjustment_enabled = false
	env.glow_enabled = false
	env.fog_enabled = false
	plate_mode = true
	for d in dynamic_nodes:
		_paint(d)
	# Painterly filter over the 3D pieces: a screen quad that only touches stencil 1.
	var quad := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(1, 1)
	quad.mesh = qm
	var pm := ShaderMaterial.new()
	pm.shader = load("res://painterly_post.gdshader")
	pm.render_priority = 100
	quad.material_override = pm
	quad.extra_cull_margin = 16384.0
	quad.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(quad)
	tiles_root.child_entered_tree.connect(func(n: Node) -> void: _paint.call_deferred(n))


# ---- Painted look for the live pieces ------------------------------------------

var _painted := {}
var _brush: Texture2D


## Swap every material under `root` for its painted version (plus an outline pass).
func _paint(root: Node) -> void:
	if _brush == null:
		_brush = load("res://assets/textures/painted_brush.png")
	var stack: Array = [[root, _outline_width_of(root), root.get_meta("crisp", false), root.get_meta("saturation", 1.35)]]
	while not stack.is_empty():
		var item: Array = stack.pop_back()
		var n: Node = item[0]
		var w: float = n.get_meta("outline_width", item[1])
		var crisp: bool = n.get_meta("crisp", item[2])
		var sat: float = n.get_meta("saturation", item[3])
		for c in n.get_children():
			stack.append([c, w, crisp, sat])
		if not n is MeshInstance3D or (n as MeshInstance3D).mesh == null:
			continue
		var mi := n as MeshInstance3D
		if mi.material_override:
			mi.material_override = _painted_material(mi.material_override, w, mi.get_meta("ink", 0.0), mi.get_meta("crate", Vector3.ZERO), crisp, sat)
			continue
		for i in mi.mesh.get_surface_count():
			var src := mi.get_active_material(i)
			mi.set_surface_override_material(i, _painted_material(src, w, 0.0, Vector3.ZERO, crisp, sat))


## Outline width inherited from the nearest ancestor with an "outline_width" meta.
func _outline_width_of(n: Node) -> float:
	while n:
		if n.has_meta("outline_width"):
			return n.get_meta("outline_width")
		n = n.get_parent()
	return 0.014


func _painted_material(src: Material, width: float, ink := 0.0, crate := Vector3.ZERO, crisp := false, saturation := 1.35) -> Material:
	if src is ShaderMaterial and (src as ShaderMaterial).shader in [load("res://painted.gdshader"), load("res://painted_crisp.gdshader")]:
		return src
	var key := "%d/%s/%s/%s/%s/%s" % [src.get_instance_id() if src else 0, width, ink, crate, crisp, saturation]
	if _painted.has(key):
		return _painted[key]
	var m := ShaderMaterial.new()
	m.shader = load("res://painted_crisp.gdshader" if crisp else "res://painted.gdshader")
	m.set_shader_parameter("brush", _brush)
	m.set_shader_parameter("ink", ink)
	m.set_shader_parameter("saturation", saturation)
	if crate != Vector3.ZERO:
		m.set_shader_parameter("use_crate", true)
		m.set_shader_parameter("crate_size", crate)
		m.set_shader_parameter("crate_texture", load("res://assets/textures/painted_crate.png"))
	if src is BaseMaterial3D:
		var b := src as BaseMaterial3D
		m.set_shader_parameter("albedo", b.albedo_color)
		if b.albedo_texture:
			m.set_shader_parameter("albedo_texture", b.albedo_texture)
		m.set_shader_parameter("use_vertex_color", b.vertex_color_use_as_albedo)
	if width > 0.0:
		var o := ShaderMaterial.new()
		o.shader = load("res://painted_outline.gdshader")
		o.set_shader_parameter("width", width)
		m.next_pass = o
	_painted[key] = m
	return m


## Render `count` frames of the phone view at 15 fps (train running, wind on) into
## res://shots/frames/, for a GIF of the painted plate in motion.
func _render_frames(count: int) -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://shots/frames"))
	var args := OS.get_cmdline_user_args()
	var cam_i := int(args[args.find("--frames-cam") + 1]) if "--frames-cam" in args else 6
	get_window().size = Vector2i(720, 1280) if cam_i == 6 else Vector2i(1280, 720)
	_set_time(false)
	if cam_i < CAMERAS:
		_set_camera(cam_i)
	_place_train(0.0)
	for i in 10:
		await get_tree().process_frame
	var start := Time.get_ticks_msec()
	for i in count:
		var target := start + int(i * 1000.0 / 15.0)
		while Time.get_ticks_msec() < target:
			await get_tree().process_frame
		_advance_train(1.0 / 15.0)
		if cam_i == 7:
			_chase_camera()
		await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png("res://shots/frames/%03d.png" % i)
	print("saved %d frames" % count)


## Chase view for checking the ride: behind and above the lead car, looking at it.
func _chase_camera() -> void:
	var f := _frame_at(train_progress - CAR_GAP)
	var p: Vector3 = f[0]
	var fwd: Vector3 = f[1]
	var flat := Vector3(fwd.x, 0, fwd.z)
	flat = flat.normalized() if flat.length() > 0.2 else Vector3.FORWARD
	cam.projection = Camera3D.PROJECTION_PERSPECTIVE
	cam.fov = 50.0
	var want := p - flat * 1.6 + Vector3.UP * 1.1 + flat.cross(Vector3.UP) * 0.6
	cam.position = want if cam.position.distance_to(want) > 3.0 else cam.position.lerp(want, 0.25)
	cam.look_at(p, Vector3.UP)


## Render the phone view without the moving parts, as the source for painting a plate.
func _render_plate_source() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://shots"))
	for d in dynamic_nodes:
		d.visible = false
	get_window().size = Vector2i(720, 1280)
	_set_time(false)
	_set_camera(6)
	for i in 6:
		await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png("res://shots/plate_src_phone_day.png")
	print("saved plate_src_phone_day")
	get_tree().quit()


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
		# The crate textures are already tinted; a milder boost keeps them from glaring.
		n.set_meta("saturation", 1.1)
		return n
	var col: Color = TIER_COLORS[tier]
	box(Vector3(0.84, 0.2, 0.84), col, Vector3(0, 0.1, 0), n).set_meta("crate", Vector3(0.84, 0.84, 0.84))
	box(Vector3(0.78, 0.04, 0.78), col.lightened(0.18), Vector3(0, 0.215, 0), n).set_meta("crate", Vector3(0.78, 0.78, 0.78))
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
				var zone_from := pts.size() - 1
				for k in range(1, 12):
					var a := TAU * k / 12.0
					pts.append(start + Vector3(0, r, 0) + fwd * sin(a) * r - Vector3(0, cos(a) * r, 0) + right * (k / 12.0 - 0.5) * 0.24)
				pts.append(start + fwd * 0.4 * ELEMENT_SCALE + right * 0.12)
				inversion_zones.append([pts[zone_from], pts[pts.size() - 1]])
				loop_r_max = maxf(loop_r_max, r)
			4:
				# Helix: a rising turn and a quarter, so it leaves heading right (toward the
				# next cell) instead of doubling back.
				for k in 11:
					var a := TAU * k / 8.0
					pts.append(base + (fwd * sin(a) + right * (1.0 - cos(a))) * 0.3 * ELEMENT_SCALE + Vector3(0, k * 0.05, 0))
			6:
				# Corkscrew: one roll along the direction of travel, stretched over the cell.
				for k in 9:
					var a := TAU * k / 8.0
					pts.append(base + fwd * (-0.45 + 0.9 * k / 8.0) + (right * sin(a) + Vector3(0, 1.0 - cos(a), 0)) * 0.26)
				inversion_zones.append([pts[pts.size() - 9], pts[pts.size() - 1]])
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
	# Handles along the neighbors' direction, but no longer than a third of the shorter
	# neighboring segment, so closely spaced points (loops, helix) can't overshoot into knots.
	for i in n + 1:
		var p := pts[i % n]
		var a := pts[(i - 1 + n) % n]
		var b := pts[(i + 1) % n]
		var h := (b - a).normalized() * minf(p.distance_to(a), p.distance_to(b)) * 0.36
		curve.add_point(p, -h, h)
	track_path = Path3D.new()
	track_path.curve = curve
	add_child(track_path)
	_build_frames(curve)
	_build_track_mesh(curve)
	_build_train()


# ---- Track frames and ride physics ---------------------------------------------
# One smooth frame (position, forward, up) every FRAME_STEP along the track, shared by
# the track mesh and the cars, so the cars always sit exactly on the rails. The up
# vector is carried along without twisting (parallel transport), so it follows the
# rails through loops and corkscrews instead of flipping, and eases back to level
# wherever the track isn't upside down (so hills and helixes stay flat, not banked).

const FRAME_STEP := 0.02
var frame_pos: PackedVector3Array = []
var frame_fwd: PackedVector3Array = []
var frame_up: PackedVector3Array = []
var track_length := 0.0


func _build_frames(curve: Curve3D) -> void:
	# Sample densely, smooth out any remaining corners, then resample at even spacing.
	var raw_len := curve.get_baked_length()
	var m := int(raw_len / 0.02)
	var raw := PackedVector3Array()
	raw.resize(m)
	for i in m:
		raw[i] = curve.sample_baked(i * raw_len / m, true)
	# ~10 cm of smoothing: rounds off hairpins where the helix and corkscrew hand over to
	# the next cell, barely changes the 0.8 m loops.
	for it in 60:
		var nxt := raw.duplicate()
		for i in m:
			nxt[i] = (raw[(i - 1 + m) % m] + raw[i] * 2.0 + raw[(i + 1) % m]) * 0.25
		raw = nxt
	var cum := PackedFloat32Array()
	cum.resize(m + 1)
	cum[0] = 0.0
	for i in m:
		cum[i + 1] = cum[i] + raw[i].distance_to(raw[(i + 1) % m])
	track_length = cum[m]
	var n := int(track_length / FRAME_STEP)
	frame_pos.resize(n)
	frame_fwd.resize(n)
	frame_up.resize(n)
	var k := 0
	for i in n:
		var d := i * track_length / n
		while cum[k + 1] < d:
			k += 1
		var w := (d - cum[k]) / maxf(cum[k + 1] - cum[k], 1e-6)
		frame_pos[i] = raw[k].lerp(raw[(k + 1) % m], w)
	for i in n:
		frame_fwd[i] = (frame_pos[(i + 1) % n] - frame_pos[(i - 1 + n) % n]).normalized()
	# Heights for the ride physics.
	ride_h_max = -INF
	for p in frame_pos:
		ride_h_max = maxf(ride_h_max, p.y)
	# Curvature vector (toward the center of the turn), smoothed over ~20 cm.
	var kappa := PackedVector3Array()
	kappa.resize(n)
	var hs := 5
	for i in n:
		var a := frame_pos[(i - hs + n) % n]
		var b := frame_pos[i]
		var c := frame_pos[(i + hs) % n]
		kappa[i] = (a + c - b * 2.0) / pow(hs * FRAME_STEP, 2)
	for it in 6:
		var nxt := kappa.duplicate()
		for i in n:
			nxt[i] = (kappa[(i - 1 + n) % n] + kappa[i] * 2.0 + kappa[(i + 1) % n]) * 0.25
		kappa = nxt
	# The ride's minimum speed: enough that even the widest loop still presses the riders
	# into their seats at its top (v²/r ≥ 2g, measured at the highest point to be safe).
	ride_v_min = sqrt(2.0 * RIDE_G * loop_r_max)
	# Each inversion element as a range of frames, found in order along the track.
	inversion_ranges.clear()
	var from := 0
	for z in inversion_zones:
		var i0 := _nearest_frame(z[0], from)
		var i1 := _nearest_frame(z[1], i0)
		inversion_ranges.append([i0, i1])
		from = i1
	# The car's up is the force the riders feel: centripetal acceleration plus gravity
	# (heartline). Flat track: straight up. Loops: toward the center, so the car is upside
	# down at the top. Helixes bank, corkscrews roll. Low-passed along the track (carried
	# forward without twisting), twice around so the seam at the station closes up.
	var up := Vector3.UP
	for lap in 2:
		for i in n:
			var t := frame_fwd[i]
			var prev := frame_fwd[(i - 1 + n) % n]
			if prev.cross(t).length() > 1e-6:
				up = Quaternion(prev, t) * up
			up = (up - t * up.dot(t)).normalized()
			var v2 := _speed_sq_at(frame_pos[i].y)
			var felt := kappa[i] * v2 + Vector3.UP * RIDE_G
			felt -= t * felt.dot(t)
			var level := Vector3.UP - t * t.y
			var steer := true
			if not _in_inversion_zone(i):
				# Outside loops and corkscrews: bank into turns, but never flip over a crest
				# (the riders get airtime instead). On near-vertical track, just carry on.
				if level.length() > 0.25:
					level = level.normalized()
					var lift := felt.dot(level)
					var lateral := (felt - level * lift).length()
					# Bank at most 65° (like a real helix), however tight the turn.
					felt += level * (maxf(maxf(lift, RIDE_G * 0.8), lateral / tan(deg_to_rad(MAX_BANK))) - lift)
				else:
					steer = false
			if steer and felt.length() > 0.3 * RIDE_G:
				up = up.slerp(felt.normalized(), 0.08).normalized()
			frame_up[i] = up


func _in_inversion_zone(i: int) -> bool:
	for r in inversion_ranges:
		if i >= r[0] and i <= r[1]:
			return true
	return false


## Index of the frame closest to p, searching forward from `from` (at most one lap).
func _nearest_frame(p: Vector3, from: int) -> int:
	var n := frame_pos.size()
	var best := from
	var best_d := INF
	for k in n:
		var i := (from + k) % n
		var d := frame_pos[i].distance_squared_to(p)
		if d < best_d:
			best_d = d
			best = i
	return best


## Speed² from energy: v² = v_min² + 2g·(h_max − h).
func _speed_sq_at(h: float) -> float:
	return ride_v_min * ride_v_min + 2.0 * RIDE_G * maxf(ride_h_max - h, 0.0)


## [position, forward, up, right] at distance `o` along the track (wraps around).
func _frame_at(o: float) -> Array:
	var n := frame_pos.size()
	var f := fposmod(o, track_length) / FRAME_STEP
	var i := int(f) % n
	var j := (i + 1) % n
	var w := f - floorf(f)
	var p := frame_pos[i].lerp(frame_pos[j], w)
	var fwd := frame_fwd[i].slerp(frame_fwd[j], w).normalized()
	var up := frame_up[i].slerp(frame_up[j], w)
	up = (up - fwd * up.dot(fwd)).normalized()
	var right := fwd.cross(up).normalized()
	return [p, fwd, up, right]


func _frame(_curve: Curve3D, o: float) -> Array:
	return _frame_at(o)


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
	# Painted-coaster look (target: art/paintover/track_target.png): chunky red rails
	# with a lighter top and darker underside baked into vertex colors, dark wooden
	# ties wider than the gauge, and wooden trestles with cross-bracing.
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var total := curve.get_baked_length()
	var step := 0.05
	var rails := [[], []]
	var rail_cols := [[], []]
	var o := 0.0
	var i := 0
	var supports := []
	var last_support := -1.0
	while o <= total + 0.001:
		var f := _frame(curve, o)
		var p: Vector3 = f[0]
		var fwd: Vector3 = f[1]
		var up: Vector3 = f[2]
		var right: Vector3 = f[3]
		for s in 2:
			var c: Vector3 = p + right * (0.12 if s == 0 else -0.12) + up * 0.05
			var ring := []
			var cols := []
			for k in 8:
				var a := TAU * k / 8.0
				var d := right * cos(a) + up * sin(a)
				ring.append(c + d * 0.05)
				var t := d.dot(up)
				# Painted rail: a narrow bright highlight on top, dark underneath, and slow
				# lighter/darker patches along the length like brush strokes.
				var stroke := 1.0 + 0.09 * noise.get_noise_1d(o * 40.0 + s * 17.0)
				var col := RAIL_MID.lerp(RAIL_TOP, pow(maxf(t, 0.0), 6.0)) if t > 0.0 else RAIL_MID.lerp(RAIL_UNDER, -t)
				cols.append(Color(col.r * stroke, col.g * stroke, col.b * stroke))
			rails[s].append(ring)
			rail_cols[s].append(cols)
		if i % 3 == 0:
			# Wooden tie with a lighter, sunlit top plank.
			var tie := jitter(Color("#7a5236"), 0.06)
			_oriented_box(st, p - up * 0.01, right * 0.2, up * 0.02, fwd * 0.028, tie)
			_oriented_box(st, p + up * 0.012, right * 0.19, up * 0.004, fwd * 0.024, tie.lightened(0.28))
		var height := p.y - PLOT_TOP
		var fi := int(o / FRAME_STEP)
		if up.y > 0.8 and height > 0.3 and o - last_support > 0.9 and not _in_inversion_zone(fi) and not _track_below(p):
			supports.append([p - up * 0.03, right])
			last_support = o
		o += step
		i += 1
	for s in 2:
		_tube_colored(st, rails[s], rail_cols[s])
	for sp in supports:
		_trestle(st, sp[0], sp[1])
	st.generate_normals()
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 0.55
	var track_mi := add_mesh(st.commit(), m, Vector3.ZERO)
	track_mi.set_meta("outline_width", 0.006)
	track_mi.set_meta("ink", 0.35)
	track_mi.set_meta("saturation", 1.05)
	track_mi.set_meta("crisp", true)


const RAIL_MID := Color("#d23a2c")
const RAIL_TOP := Color("#ffc2a8")
const RAIL_UNDER := Color("#6e1d17")
const WOOD := Color("#9a6a3e")


## True if another part of the track passes under p (a support there would pierce it).
func _track_below(p: Vector3) -> bool:
	for q in frame_pos:
		if q.y < p.y - 0.2 and Vector2(q.x - p.x, q.z - p.z).length() < 0.3:
			return true
	return false


## Two wooden posts from the track down to the plot, with a cap beam and X-bracing.
func _trestle(st: SurfaceTool, top: Vector3, right: Vector3) -> void:
	var r := Vector3(right.x, 0, right.z).normalized()
	var fz := r.cross(Vector3.UP)
	var legs := [top + r * 0.15, top - r * 0.15]
	for leg in legs:
		_beam(st, Vector3(leg.x, PLOT_TOP, leg.z), leg, 0.045, fz, jitter(WOOD, 0.05))
	_beam(st, legs[0], legs[1], 0.04, fz, jitter(WOOD.darkened(0.15), 0.04))
	var h: float = top.y - PLOT_TOP
	var levels := maxi(1, int(h / 0.4))
	for k in levels:
		var z0: float = PLOT_TOP + h * k / levels
		var z1: float = PLOT_TOP + h * (k + 1) / levels
		var a0 := Vector3(legs[0].x, z0, legs[0].z)
		var b1 := Vector3(legs[1].x, z1, legs[1].z)
		_beam(st, a0, b1, 0.024, fz, jitter(WOOD.darkened(0.1), 0.05))
		if k > 0:
			_beam(st, a0, Vector3(legs[1].x, z0, legs[1].z), 0.024, fz, jitter(WOOD.darkened(0.1), 0.05))


## A square wooden beam from a to b; `side` fixes which way its faces point.
func _beam(st: SurfaceTool, a: Vector3, b: Vector3, half: float, side: Vector3, col: Color) -> void:
	var axis := (b - a) * 0.5
	var x := side.cross(axis.normalized()).normalized() * half
	_oriented_box(st, (a + b) * 0.5, x, axis, side.normalized() * half, col)


func _tube_colored(st: SurfaceTool, rings: Array, cols: Array) -> void:
	for i in rings.size() - 1:
		var a: Array = rings[i]
		var b: Array = rings[i + 1]
		for k in a.size():
			var k2 := (k + 1) % a.size()
			var verts := [[a[k], cols[i][k]], [b[k2], cols[i + 1][k2]], [b[k], cols[i + 1][k]], [a[k], cols[i][k]], [a[k2], cols[i][k2]], [b[k2], cols[i + 1][k2]]]
			for v in verts:
				st.set_color(v[1])
				st.add_vertex(v[0])

const CAR_GAP := 0.34
## Height of the car's floor above the track centerline (the rails' top).
const CAR_RIDE := 0.09
## Ride physics: the train leaves the station with enough energy to clear the highest
## point at ride_v_min (set from the tightest inversion), then trades height for speed.
const RIDE_G := 1.5
const MAX_BANK := 65.0
const RIDE_V_STATION := 0.5
const RIDE_RAMP := 0.9
var ride_h_max := 0.0
var ride_v_min := 1.0
## [first point, last point] of each loop and corkscrew: the only places the car may turn
## upside down. Mapped to frame ranges along the track in _build_frames.
var inversion_zones: Array = []
var inversion_ranges: Array = []
var loop_r_max := 0.3


func _build_train() -> void:
	var shirts := [Color("#f0584e"), Color("#45a8e0"), Color("#ffd23f"), Color("#72c457"), Color("#9d6ef0"), Color("#ff8fb8")]
	var train := Node3D.new()
	add_child(train)
	for k in 4:
		var car := Node3D.new()
		train.add_child(car)
		if not model("coaster_car", car, Vector3.ZERO):
			box(Vector3(0.26, 0.1, 0.3), Color("#e34a3c"), Vector3(0, 0.05, 0), car)
			box(Vector3(0.27, 0.03, 0.31), Color("#ffd23f"), Vector3(0, 0.02, 0), car)
		for side in [-0.06, 0.06]:
			sphere(0.045, Color("#f2c9a5"), Vector3(side, 0.16, 0), Vector3.ONE, car)
			sphere(0.03, shirts[rng.randi() % shirts.size()], Vector3(side, 0.11, 0), Vector3(1.4, 1.0, 1.0), car)
		cars.append(car)
	_place_train(9.0)


func _place_train(progress: float) -> void:
	train_progress = fposmod(progress, track_length)
	for k in cars.size():
		var f := _frame_at(train_progress - k * CAR_GAP)
		var fwd: Vector3 = f[1]
		var up: Vector3 = f[2]
		var right: Vector3 = f[3]
		cars[k].global_transform = Transform3D(Basis(right, up, -fwd), f[0] + up * CAR_RIDE)


## Train speed at the current spot: energy for the ride, easing out of and into the station.
func _ride_speed() -> float:
	var mid := _frame_at(train_progress - CAR_GAP * (cars.size() - 1) * 0.5)
	var v := sqrt(_speed_sq_at(mid[0].y))
	var from_start := train_progress
	var to_end := track_length - train_progress
	var ramp := clampf(minf(from_start, to_end) / RIDE_RAMP, 0.0, 1.0)
	return lerpf(RIDE_V_STATION, v, smoothstep(0.0, 1.0, ramp))


## Prints how smooth the ride frames are and the speed over one lap (for tests).
func _ride_check() -> void:
	var n := frame_up.size()
	var worst := 0.0
	var worst_at := 0.0
	var worst_fwd := 0.0
	for i in n:
		var a := rad_to_deg(frame_up[i].angle_to(frame_up[(i + 1) % n]))
		if a > worst:
			worst = a
			worst_at = i * FRAME_STEP
		worst_fwd = maxf(worst_fwd, rad_to_deg(frame_fwd[i].angle_to(frame_fwd[(i + 1) % n])))
	var inverted := 0
	for u in frame_up:
		if u.y < 0.0:
			inverted += 1
	train_progress = 0.0
	var t := 0.0
	var vmin := INF
	var vmax := 0.0
	var laps := 0.0
	while t < 120.0 and laps < 1.0:
		var v := _ride_speed()
		vmin = minf(vmin, v)
		vmax = maxf(vmax, v)
		var before := train_progress
		_advance_train(1.0 / 60.0)
		laps += fposmod(train_progress - before, track_length) / track_length
		t += 1.0 / 60.0
	for i in n:
		var d := rad_to_deg(frame_fwd[i].angle_to(frame_fwd[(i + 1) % n]))
		if d > 8.0:
			print("  kink %.1f deg at %.2f m, pos %s" % [d, i * FRAME_STEP, frame_pos[i]])
	var run_start := -1
	for i in n + 1:
		var inv := i < n and frame_up[i].y < 0.0
		if inv and run_start < 0:
			run_start = i
		elif not inv and run_start >= 0:
			print("  inverted %.2f..%.2f m (%s .. %s)" % [run_start * FRAME_STEP, i * FRAME_STEP, frame_pos[run_start].snapped(Vector3.ONE * 0.1), frame_pos[i - 1].snapped(Vector3.ONE * 0.1)])
			run_start = -1
	print("ride check: length %.2f m, %d frames, max up turn %.2f deg/step at %.2f m, max forward turn %.2f deg/step, %d%% inverted" % [track_length, n, worst, worst_at, worst_fwd, inverted * 100 / n])
	print("ride check: lap %.1f s, speed %.2f..%.2f m/s" % [t, vmin, vmax])


func _advance_train(delta: float) -> void:
	# Small substeps so speed changes smoothly through dips and over crests.
	var steps := 4
	for i in steps:
		_place_train(train_progress + _ride_speed() * delta / steps)


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
	var guest := model(drop_in, self, pos, Vector3.ONE, rng.randf() * TAU) if drop_in != "" else null
	if guest:
		guest.set_meta("outline_width", 0.006)
		guest.set_meta("crisp", true)
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
	_advance_train(delta)


func _render_shots() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://shots"))
	# macOS applies window resizes a few frames late; let the first one settle.
	for i in 10:
		await get_tree().process_frame
	if "--frames" in OS.get_cmdline_user_args():
		await _render_frames(int(OS.get_cmdline_user_args()[OS.get_cmdline_user_args().find("--frames") + 1]))
		get_tree().quit()
		return
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
	if plate_mode:
		shots = [["10_phone_plate_day", 6, false, 9.0, Vector2i(720, 1280)]]
		if "--swipe-test" in OS.get_cmdline_user_args():
			# New tiles from a swipe must come out painted too.
			_swipe(Vector2i(0, 1))
			for i in 20:
				await get_tree().process_frame
			shots = [["12_phone_plate_after_swipe", 6, false, 9.0, Vector2i(720, 1280)]]
	for s in shots:
		var size: Vector2i = s[4] if s.size() > 4 else Vector2i(1600, 1000)
		if get_window().size != size:
			get_window().size = size
			for i in 10:
				await get_tree().process_frame
		_set_time(s[2])
		_set_camera(s[1])
		_place_train(s[3])
		for i in 6:
			await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png("res://shots/%s.png" % s[0])
		print("saved ", s[0])
	get_tree().quit()
