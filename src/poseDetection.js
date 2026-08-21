const pose = new Pose({
locateFile:(file)=>{
return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
}
});

pose.setOptions({
modelComplexity:1,
smoothLandmarks:true,
enableSegmentation:true
});

pose.onResults(results=>{
console.log("IA detectando cuerpo", results.poseLandmarks);
});
