# Builds the tiny ONNX model the voice e2e tests serve in place of Kokoro (the real one is 92-326 MB).
# It outputs a short 440 Hz tone, so a test can check that the vendored ONNX Runtime loads and runs it,
# and that the audio plays in the extension.
#   pip install onnx && python3 tests/fixtures/tts/make-models.py
import math
import os

import onnx
from onnx import TensorProto, helper

HERE = os.path.dirname(os.path.abspath(__file__))


def model(nodes, inputs, outputs, initializer):
    graph = helper.make_graph(nodes, "tiny", inputs, outputs, initializer=initializer)
    # Opset 13 / IR 8 load in the ONNX Runtime the extension ships.
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    m.ir_version = 8
    onnx.checker.check_model(m)
    return m


def scalar(name, value):
    return helper.make_tensor(name, TensorProto.FLOAT, [], [value])


def tone(inputs, output, sample_rate, seconds=0.3):
    """Ignores its inputs and returns a quiet sine tone."""
    return model(
        [
            helper.make_node("Range", ["start", "limit", "delta"], ["t"]),
            helper.make_node("Mul", ["t", "step"], ["phase"]),
            helper.make_node("Sin", ["phase"], ["wave"]),
            helper.make_node("Mul", ["wave", "level"], [output]),
        ],
        inputs,
        [helper.make_tensor_value_info(output, TensorProto.FLOAT, ["samples"])],
        [
            scalar("start", 0.0),
            scalar("limit", float(int(sample_rate * seconds))),
            scalar("delta", 1.0),
            scalar("step", 2 * math.pi * 440 / sample_rate),
            scalar("level", 0.1),
        ],
    )


def save(m, name):
    onnx.save(m, os.path.join(HERE, name))


# The inputs and output of a Kokoro model.
save(
    tone(
        [
            helper.make_tensor_value_info("input_ids", TensorProto.INT64, [1, "tokens"]),
            helper.make_tensor_value_info("style", TensorProto.FLOAT, [1, 256]),
            helper.make_tensor_value_info("speed", TensorProto.FLOAT, [1]),
        ],
        "waveform",
        24000,
    ),
    "kokoro-tone.onnx",
)
