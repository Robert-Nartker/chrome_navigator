"""Makes the tiny synthetic Qwen3-ASR checkpoints the packer test uses, and packs them with the reference
C packer (github.com/ainoya/qwen-asr, `./qwen_asr -d DIR --pack-q8 OUT`), which the JavaScript port must
match byte for byte.

    python3 make.py /path/to/qwen_asr
"""
import json, os, struct, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)

def bf16(shape, zero_block=False):
    x = rng.standard_normal(shape).astype(np.float32) * 0.05
    if zero_block:
        x.reshape(-1)[:64] = 0  # a block whose scale is 0
    return (x.view(np.uint32) >> 16).astype(np.uint16)

def write(path, tensors, header_order):
    """tensors: name -> (dtype, array). Data is laid out in dict order; the header lists header_order."""
    header, blobs, off = {}, [], 0
    for name, (dtype, arr) in tensors.items():
        raw = arr.tobytes()
        header[name] = {"dtype": dtype, "shape": list(arr.shape), "data_offsets": [off, off + len(raw)]}
        blobs.append(raw)
        off += len(raw)
    ordered = {"__metadata__": {"format": "pt"}}
    ordered.update({n: header[n] for n in header_order})
    js = json.dumps(ordered, separators=(",", ":")).encode()
    with open(path, "wb") as f:
        f.write(struct.pack("<Q", len(js)))
        f.write(js)
        f.write(b"".join(blobs))

L0 = "thinker.model.layers.0."
tensors = {
    "thinker.audio_tower.conv2d1.weight": ("BF16", bf16((2, 1, 3, 3))),
    "thinker.audio_tower.conv2d1.bias": ("F32", rng.standard_normal(2).astype(np.float32)),
    "thinker.audio_tower.odd.weight": ("BF16", bf16((3, 10))),
    L0 + "mlp.up_proj.weight": ("BF16", bf16((4, 128))),
    L0 + "mlp.down_proj.weight": ("BF16", bf16((8, 128), zero_block=True)),
    L0 + "input_layernorm.weight": ("BF16", bf16((64,))),
    L0 + "mlp.gate_proj.weight": ("BF16", bf16((4, 128))),
    "thinker.model.embed_tokens.weight": ("BF16", bf16((6, 64))),
    "thinker.lm_head.weight": ("BF16", bf16((6, 64))),
}
names = list(tensors)

single = os.path.join(HERE, "single")
os.makedirs(single, exist_ok=True)
write(os.path.join(single, "model.safetensors"), tensors, sorted(names))

# Two shards, with the gate and up projections of one layer in different files.
sharded = os.path.join(HERE, "sharded")
os.makedirs(sharded, exist_ok=True)
first = {n: tensors[n] for n in names[:4]}
second = {n: tensors[n] for n in names[4:]}
write(os.path.join(sharded, "model-00001-of-00002.safetensors"), first, list(reversed(first)))
write(os.path.join(sharded, "model-00002-of-00002.safetensors"), second, sorted(second))

for d in (single, sharded):
    subprocess.run([sys.argv[1], "-d", d, "--pack-q8", os.path.join(d, "expected.bin")], check=True)
