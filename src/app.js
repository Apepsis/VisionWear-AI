const button=document.getElementById("capture");


button.onclick=()=>{


let image=document.createElement("a");


image.download="neuralmirror-style.png";


image.href=document
.getElementById("canvas")
.toDataURL();



image.click();


};
