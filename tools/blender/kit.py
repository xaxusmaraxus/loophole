"""Low-poly building blocks for Loophole models (Blender 4+, +Z up, meters).

Model scripts in art/blender/ import this, build one asset from primitives,
then call finish(name), which joins the parts, puts the origin at the bottom
center, applies transforms, frames the view and exports
godot/assets/models/<name>.glb. Front faces -Y.
"""
import math
import os

import bpy
import bmesh
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, "godot", "assets", "models")
_parts = []


def reset():
    """Empty the scene (keeps the file, clears every object and orphan material)."""
    global _parts
    _parts = []
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)


def mat(hex_color, rough=0.8):
    name = "c_" + hex_color.lstrip("#").lower()
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    h = hex_color.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*lin, 1)
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*lin, 1)
    return m


def _add(ob, color, name):
    ob.name = name or ob.name
    ob.data.materials.clear()
    ob.data.materials.append(mat(color))
    for p in ob.data.polygons:
        p.use_smooth = True
    _parts.append(ob)
    return ob


def sphere(r, color, loc, scale=(1, 1, 1), seg=10, rings=6, name=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    ob = bpy.context.object
    ob.scale = scale
    return _add(ob, color, name)


def cyl(r, depth, color, loc, seg=10, r2=None, rot=(0, 0, 0), scale=(1, 1, 1), name=None):
    """Cylinder (or cone/frustum when r2 is given) centered at loc."""
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.scale = scale
    return _add(ob, color, name)


def box(size, color, loc, bevel=0.0, seg=1, rot=(0, 0, 0), name=None):
    """Box of full size (x, y, z) centered at loc, optionally with rounded edges."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        md = ob.modifiers.new("bevel", "BEVEL")
        md.width = bevel
        md.segments = seg
        md.limit_method = "NONE"
        bpy.ops.object.modifier_apply(modifier=md.name)
    return _add(ob, color, name)


def torus(r, thick, color, loc, rot=(0, 0, 0), seg=12, minor=6, name=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=thick, major_segments=seg,
                                     minor_segments=minor, location=loc, rotation=rot)
    return _add(bpy.context.object, color, name)


def tris(obs=None):
    n = 0
    for ob in obs or _parts:
        for p in ob.data.polygons:
            n += len(p.vertices) - 2
    return n


def finish(name, max_tris, height=None, scale=None, paint=None, paint_zmax=1.0):
    """paint: optional image path, projected from the front after joining (front_paint)."""
    """Join, origin to bottom center, apply transforms, export GLB. Returns (tris, dims)."""
    bpy.ops.object.select_all(action="DESELECT")
    for ob in _parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = _parts[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name
    if height or scale:
        s = scale or height / ob.dimensions.z
        ob.scale = (s, s, s)
        bpy.ops.object.transform_apply(scale=True)
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    offset = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    for v in ob.data.vertices:
        v.co -= offset
    ob.location = (0, 0, 0)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    if paint:
        front_paint(ob, paint, name + "_paint", zmax_frac=paint_zmax)
    n = tris([ob])
    dims = tuple(round(d, 3) for d in ob.dimensions)
    print("%s: %d tris (budget %d), dims %s" % (name, n, max_tris, dims))
    if n > max_tris:
        raise RuntimeError("%s is over budget: %d > %d tris" % (name, n, max_tris))
    os.makedirs(MODELS, exist_ok=True)
    path = os.path.join(MODELS, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(REPO, "art", "blender", name + ".blend"))
    frame()
    return n, dims


def frame():
    """Front 3/4 view on the result, solid view with material colors."""
    for area in bpy.context.screen.areas:
        if area.type != "VIEW_3D":
            continue
        space = area.spaces.active
        space.shading.type = "SOLID"
        space.shading.color_type = "MATERIAL"
        region = next(r for r in area.regions if r.type == "WINDOW")
        with bpy.context.temp_override(area=area, region=region):
            bpy.ops.view3d.view_selected()
        r3d = space.region_3d
        from mathutils import Euler
        r3d.view_rotation = Euler((math.radians(75), 0, math.radians(-30))).to_quaternion()


def preview(name, out=None):
    """Workbench render of the current model: front, side and 3/4 side by side."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 512, 640
    scene.render.film_transparent = False
    ob = bpy.data.objects[name]
    h = ob.dimensions.z
    cam_data = bpy.data.cameras.new("prev_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(ob.dimensions) * 1.3
    cam = bpy.data.objects.new("prev_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = out or os.path.join(REPO, "art", "previews")
    os.makedirs(out, exist_ok=True)
    paths = []
    for tag, yaw in (("front", 0), ("side", 90), ("34", 35)):
        a = math.radians(yaw)
        d = max(ob.dimensions) * 3
        cam.location = (math.sin(a) * d, -math.cos(a) * d, h * 0.5 + d * 0.25)
        direction = Vector((0, 0, h * 0.5)) - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        p = os.path.join(out, "%s_%s.png" % (name, tag))
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    bpy.data.objects.remove(cam, do_unlink=True)
    return paths


def mat_tex(name, image_path, rough=0.8):
    """Material with a painted image texture (embedded in the GLB on export)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(REPO, image_path), check_existing=True)
    tex.image.reload()  # pick up edits to the file since Blender first loaded it
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def textured(ob, material, size, axis_v="z"):
    """Give `ob` a textured material and box-projected UVs: one texture tile per `size` meters.
    axis_v: which world axis runs along the texture's V on side faces ('z' or 'y')."""
    ob.data.materials.clear()
    ob.data.materials.append(material)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.verify()
    mw = ob.matrix_world
    for f in bm.faces:
        n = (mw.to_3x3() @ f.normal).normalized()
        an = [abs(n.x), abs(n.y), abs(n.z)]
        for loop in f.loops:
            co = mw @ loop.vert.co
            if an[2] >= an[0] and an[2] >= an[1]:
                u, v = co.x, co.y
            elif an[0] >= an[1]:
                u, v = co.y, (co.z if axis_v == "z" else co.y)
            else:
                u, v = co.x, co.z
            loop[uv].uv = (u / size, v / size)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def tube(points, r, color, sides=6, closed=False, name=None):
    """A tube along `points` (list of (x, y, z)), built as rings of `sides` vertices."""
    import mathutils
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    n = len(pts)
    rings = []
    prev_side = None
    for i, p in enumerate(pts):
        a = pts[(i - 1) % n] if (closed or i > 0) else p
        b = pts[(i + 1) % n] if (closed or i < n - 1) else p
        t = (b - a).normalized()
        side = prev_side if prev_side is not None else (Vector((0, 0, 1)).cross(t) if abs(t.z) < 0.9 else Vector((1, 0, 0)))
        side = (side - t * side.dot(t)).normalized()
        up = t.cross(side).normalized()
        prev_side = side
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            ring.append(bm.verts.new(p + (side * math.cos(ang) + up * math.sin(ang)) * r))
        rings.append(ring)
    last = n if closed else n - 1
    for i in range(last):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((r0[k], r0[k2], r1[k2], r1[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name or "tube")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name or "tube", me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    return _add(ob, color, name)


def star(r_out, r_in, depth, color, loc, rot=(0, 0, 0), name=None):
    """A chunky five-pointed star, extruded `depth` along its local Y (faces -Y)."""
    bm = bmesh.new()
    front, back = [], []
    for k in range(10):
        ang = math.pi / 2 + k * math.pi / 5
        rr = r_out if k % 2 == 0 else r_in
        x, z = math.cos(ang) * rr, math.sin(ang) * rr
        front.append(bm.verts.new((x, -depth / 2, z)))
        back.append(bm.verts.new((x, depth / 2, z)))
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for k in range(10):
        k2 = (k + 1) % 10
        bm.faces.new((front[k], back[k], back[k2], front[k2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name or "star")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name or "star", me)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return _add(ob, color, name)


def front_paint(ob, image_path, name, facing=0.35, zmax_frac=1.0):
    """Project a painted front view onto `ob` from the front (-Y): the image spans the
    object's X width and Z height. Only faces pointing forward (normal.y < -facing) get
    the painting; the rest keep their flat material colors. zmax_frac: only the part
    below this fraction of the height is painted (e.g. to leave out a held balloon)."""
    m = mat_tex(name, image_path)
    ob.data.materials.append(m)
    slot = len(ob.data.materials) - 1
    ztop = max(v.co.z for v in ob.data.vertices) * zmax_frac
    body = [v.co for v in ob.data.vertices if v.co.z <= ztop]
    xs = [c.x for c in body]
    zs = [c.z for c in body]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        if f.normal.y < -facing and max(v.co.z for v in f.verts) <= ztop:
            f.material_index = slot
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = ((co.x - x0) / (x1 - x0), (co.z - z0) / (z1 - z0))
    bm.to_mesh(ob.data)
    bm.free()
