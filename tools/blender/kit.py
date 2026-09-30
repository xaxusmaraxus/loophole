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


def finish(name, max_tris, height=None, scale=None):
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
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 512, 640
    scene.render.film_transparent = False
    ob = bpy.data.objects[name]
    h = ob.dimensions.z
    cam_data = bpy.data.cameras.new("prev_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = h * 1.25
    cam = bpy.data.objects.new("prev_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    out = out or os.path.join(REPO, "art", "previews")
    os.makedirs(out, exist_ok=True)
    paths = []
    for tag, yaw in (("front", 0), ("side", 90), ("34", 35)):
        a = math.radians(yaw)
        d = h * 3
        cam.location = (math.sin(a) * d, -math.cos(a) * d, h * 0.5 + d * 0.25)
        direction = Vector((0, 0, h * 0.5)) - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        p = os.path.join(out, "%s_%s.png" % (name, tag))
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    bpy.data.objects.remove(cam, do_unlink=True)
    return paths
