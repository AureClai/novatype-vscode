#set document(title: "Deep Learning: A Brief Overview", author: "NovaType Demo")
#set page(paper: "a4", margin: 2cm)
#set text(font: "New Computer Modern", size: 11pt)
#set heading(numbering: "1.")
#set math.equation(numbering: "(1)")

#align(center)[
  #text(size: 20pt, weight: "bold")[Deep Learning: A Brief Overview]

  #v(0.5em)
  #text(size: 12pt, style: "italic")[A demonstration of NovaType for VS Code]
]

#v(1em)

= Introduction <sec:intro>

Deep learning has revolutionized artificial intelligence in recent years.
The transformer architecture @vaswani2017attention has become the foundation
of modern language models.

= Mathematical Foundations <sec:math>

== The Softmax Function

The softmax function normalizes a vector into a probability distribution:

$ "softmax"(x_i) = frac(e^(x_i), sum_(j=1)^n e^(x_j)) $ <eq:softmax>

As shown in @eq:softmax, the output values sum to 1.

== Attention Mechanism

The scaled dot-product attention is defined as:

$ "Attention"(Q, K, V) = "softmax"(frac(Q K^T, sqrt(d_"model"))) V $ <eq:attention>

The attention mechanism (@eq:attention) allows the model to focus on relevant parts of the input.

= Results <sec:results>

#figure(
  table(
    columns: 3,
    [*Model*], [*Parameters*], [*Accuracy*],
    [GPT-2], [1.5B], [94.2%],
    [BERT], [340M], [93.1%],
    [T5], [11B], [96.8%],
  ),
  caption: [Comparison of transformer models],
) <tbl:results>

@tbl:results shows the performance comparison. For more details on BERT, see @devlin2019bert.

<fig:architecture>

@fig:architecture

= Conclusion <sec:conclusion>

The transformer architecture has enabled significant advances in NLP, as demonstrated by @brown2020language.

Test référence : @Pant_2024.

#bibliography("references.bib")
