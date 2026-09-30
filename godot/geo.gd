extends RefCounted
## Geometry batch: appends flat-shaded, vertex-colored primitives into one mesh.
## Convex primitives orient their triangles outward automatically, so callers
## never think about winding. Commit once per batch and draw it with one material.

var st := SurfaceTool.new()
var count := 0


func _init() -> void:
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(-1)


## One triangle, flipped if needed so it faces away from `inside`.
## Godot's front faces wind clockwise, so the right-hand normal must point inward.
func tri(a: Vector3, b: Vector3, c: Vector3, col: Color, inside: Vector3) -> void:
	var n := (b - a).cross(c - a)
	if n.dot((a + b + c) / 3.0 - inside) > 0.0:
		var t := b
		b = c
		c = t
	st.set_color(col)
	st.add_vertex(a)
	st.set_color(col)
	st.add_vertex(b)
	st.set_color(col)
	st.add_vertex(c)
	count += 1


func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, col: Color, inside: Vector3) -> void:
	tri(a, b, c, col, inside)
	tri(a, c, d, col, inside)


## Box (optionally chamfered) at transform `xf` (the box spans ±size/2 in local space).
func box(xf: Transform3D, size: Vector3, col: Color, bevel := 0.0) -> void:
	var h := size / 2.0
	var o := xf.origin
	if bevel <= 0.0:
		var c := []
		for sx in [-1, 1]:
			for sy in [-1, 1]:
				for sz in [-1, 1]:
					c.append(xf * Vector3(sx * h.x, sy * h.y, sz * h.z))
		for f in [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]:
			quad(c[f[0]], c[f[1]], c[f[2]], c[f[3]], col, o)
		return
	var b := minf(bevel, minf(h.x, minf(h.y, h.z)) * 0.9)
	# Three points per corner: one on each face touching it.
	var px := func(sx: int, sy: int, sz: int) -> Vector3: return xf * Vector3(sx * h.x, sy * (h.y - b), sz * (h.z - b))
	var py := func(sx: int, sy: int, sz: int) -> Vector3: return xf * Vector3(sx * (h.x - b), sy * h.y, sz * (h.z - b))
	var pz := func(sx: int, sy: int, sz: int) -> Vector3: return xf * Vector3(sx * (h.x - b), sy * (h.y - b), sz * h.z)
	var edge := col.darkened(0.06)
	for s in [-1, 1]:
		quad(px.call(s, -1, -1), px.call(s, 1, -1), px.call(s, 1, 1), px.call(s, -1, 1), col, o)
		quad(py.call(-1, s, -1), py.call(1, s, -1), py.call(1, s, 1), py.call(-1, s, 1), col.lightened(0.04) if s > 0 else col, o)
		quad(pz.call(-1, -1, s), pz.call(1, -1, s), pz.call(1, 1, s), pz.call(-1, 1, s), col, o)
	for a in [-1, 1]:
		for c2 in [-1, 1]:
			# Edges along z (between x and y faces), along y (x and z), along x (y and z).
			quad(px.call(a, c2, -1), px.call(a, c2, 1), py.call(a, c2, 1), py.call(a, c2, -1), edge, o)
			quad(px.call(a, -1, c2), px.call(a, 1, c2), pz.call(a, 1, c2), pz.call(a, -1, c2), edge, o)
			quad(py.call(-1, a, c2), py.call(1, a, c2), pz.call(1, a, c2), pz.call(-1, a, c2), edge, o)
	for sx in [-1, 1]:
		for sy in [-1, 1]:
			for sz in [-1, 1]:
				tri(px.call(sx, sy, sz), py.call(sx, sy, sz), pz.call(sx, sy, sz), edge, o)


## Cylinder or cone along local +Y, centered at xf.origin.
func cyl(xf: Transform3D, r_bottom: float, r_top: float, h: float, col: Color, sides := 8, cap_col := Color(0, 0, 0, 0)) -> void:
	var top_col := col if cap_col.a == 0.0 else cap_col
	var o := xf.origin
	var bot := []
	var top := []
	for k in sides:
		var a := TAU * (k + 0.5) / sides
		bot.append(xf * Vector3(cos(a) * r_bottom, -h / 2.0, sin(a) * r_bottom))
		top.append(xf * Vector3(cos(a) * r_top, h / 2.0, sin(a) * r_top))
	var cb := xf * Vector3(0, -h / 2.0, 0)
	var ct := xf * Vector3(0, h / 2.0, 0)
	for k in sides:
		var k2 := (k + 1) % sides
		if r_top > 0.0001:
			quad(bot[k], bot[k2], top[k2], top[k], col, o)
			tri(ct, top[k], top[k2], top_col, o)
		else:
			tri(bot[k], bot[k2], ct, col, o)
		tri(cb, bot[k], bot[k2], col.darkened(0.2), o)


## Low-poly UV sphere, optionally squashed by `scale3`; `smooth` gives soft shading.
func sphere(center: Vector3, r: float, col: Color, scale3 := Vector3.ONE, segs := 10, rings := 6, smooth := false, basis := Basis()) -> void:
	if smooth:
		st.set_smooth_group(1)
	var pts := []
	for i in rings + 1:
		var v := PI * i / rings
		var row := []
		for k in segs:
			var u := TAU * k / segs
			var p := Vector3(sin(v) * cos(u), cos(v), sin(v) * sin(u)) * r * scale3
			row.append(center + basis * p)
		pts.append(row)
	for i in rings:
		for k in segs:
			var k2 := (k + 1) % segs
			if i == 0:
				tri(pts[i][k], pts[i + 1][k], pts[i + 1][k2], col, center)
			elif i == rings - 1:
				tri(pts[i][k], pts[i][k2], pts[i + 1][k], col, center)
			else:
				quad(pts[i][k], pts[i][k2], pts[i + 1][k2], pts[i + 1][k], col, center)
	if smooth:
		st.set_smooth_group(-1)


## Chunky rock/foliage blob: a jittered icosahedron.
func blob(center: Vector3, r: float, col: Color, seed_v: int, jitter := 0.22, scale3 := Vector3.ONE) -> void:
	var t := (1.0 + sqrt(5.0)) / 2.0
	var verts := [
		Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0),
		Vector3(0, -1, t), Vector3(0, 1, t), Vector3(0, -1, -t), Vector3(0, 1, -t),
		Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1),
	]
	var faces := [
		[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
	]
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v
	var pts := []
	for v in verts:
		var n: Vector3 = v.normalized()
		pts.append(center + n * r * scale3 * (1.0 + rng.randf_range(-jitter, jitter)))
	for f in faces:
		var shade := col.lightened(0.07) if (pts[f[0]] + pts[f[1]] + pts[f[2]]).y / 3.0 > center.y + r * 0.3 else col
		tri(pts[f[0]], pts[f[1]], pts[f[2]], shade, center)


## Tube through a list of ring centers with their (right, up) frames.
func tube(centers: Array, rights: Array, ups: Array, r: float, col: Color, sides := 6) -> void:
	var rings := []
	for i in centers.size():
		var ring := []
		for k in sides:
			var a := TAU * (k + 0.5) / sides
			ring.append(centers[i] + (rights[i] * cos(a) + ups[i] * sin(a)) * r)
		rings.append(ring)
	for i in centers.size() - 1:
		var mid: Vector3 = (centers[i] + centers[i + 1]) / 2.0
		for k in sides:
			var k2 := (k + 1) % sides
			quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k], col, mid)


## A thin beam from a to b with a square cross-section.
func beam(a: Vector3, b: Vector3, w: float, col: Color) -> void:
	var dir := b - a
	var l := dir.length()
	if l < 0.0001:
		return
	var y := dir / l
	var x := y.cross(Vector3.FORWARD if absf(y.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT).normalized()
	var z := x.cross(y)
	box(Transform3D(Basis(x, y, z), (a + b) / 2.0), Vector3(w, l, w), col)


func commit() -> ArrayMesh:
	st.generate_normals()
	return st.commit()
