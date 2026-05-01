// import React, { useState } from "react";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Alert, AlertDescription } from "@/components/ui/alert";
// import { Progress } from "@/components/ui/progress";
// import { Download, Upload, FileSpreadsheet, AlertCircle, CheckCircle } from "lucide-react";
// import { useToast } from "@/hooks/use-toast";
// import { useMutation } from "@tanstack/react-query";
// import { apiRequest } from "@/lib/queryClient";

// interface BulkMenuImportProps {
//   restaurantId: string;
//   isOpen: boolean;
//   onClose: () => void;
//   onSuccess: () => void;
// }

// interface ImportResult {
//   success: boolean;
//   message: string;
//   imported: number;
//   failed: number;
//   errors?: string[];
// }

// export function BulkMenuImport({ restaurantId, isOpen, onClose, onSuccess }: BulkMenuImportProps) {
//   const [selectedFile, setSelectedFile] = useState<File | null>(null);
//   const [importResult, setImportResult] = useState<ImportResult | null>(null);
//   const { toast } = useToast();

//   const downloadTemplateMutation = useMutation({
//     mutationFn: async () => {
//       const token = localStorage.getItem("adminToken");
//       const response = await fetch(`/api/admin/restaurants/${restaurantId}/menu-template`, {
//         method: "GET",
//         headers: {
//           Authorization: `Bearer ${token}`,
//         },
//       });

//       if (!response.ok) {
//         throw new Error("Failed to download template");
//       }

//       const blob = await response.blob();
//       const url = window.URL.createObjectURL(blob);
//       const a = document.createElement("a");
//       a.href = url;
//       a.download = `menu-template-${restaurantId}.xlsx`;
//       document.body.appendChild(a);
//       a.click();
//       window.URL.revokeObjectURL(url);
//       document.body.removeChild(a);
//     },
//     onSuccess: () => {
//       toast({
//         title: "Template Downloaded",
//         description: "Excel template has been downloaded successfully",
//       });
//     },
//     onError: (error: any) => {
//       toast({
//         title: "Download Failed",
//         description: error.message || "Failed to download template",
//         variant: "destructive",
//       });
//     },
//   });

//   const importMenuMutation = useMutation({
//     mutationFn: async (file: File) => {
//       const token = localStorage.getItem("adminToken");
//       const formData = new FormData();
//       formData.append("menuFile", file);

//       const response = await fetch(`/api/admin/restaurants/${restaurantId}/menu-import`, {
//         method: "POST",
//         headers: {
//           Authorization: `Bearer ${token}`,
//         },
//         body: formData,
//       });

//       if (!response.ok) {
//         throw new Error(`Import failed: ${response.statusText}`);
//       }

//       return await response.json();
//     },
//     onSuccess: (result: ImportResult) => {
//       setImportResult(result);
//       if (result.success) {
//         toast({
//           title: "Import Successful",
//           description: `Successfully imported ${result.imported} menu items`,
//         });
//         onSuccess();
//       } else {
//         toast({
//           title: "Import Completed with Errors",
//           description: `Imported ${result.imported} items, ${result.failed} failed`,
//           variant: "destructive",
//         });
//       }
//     },
//     onError: (error: any) => {
//       toast({
//         title: "Import Failed",
//         description: error.message || "Failed to import menu items",
//         variant: "destructive",
//       });
//     },
//   });

//   const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
//     const file = event.target.files?.[0];
//     if (file) {
//       if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || 
//           file.type === "application/vnd.ms-excel" ||
//           file.name.endsWith('.xlsx') || 
//           file.name.endsWith('.xls')) {
//         setSelectedFile(file);
//         setImportResult(null);
//       } else {
//         toast({
//           title: "Invalid File Type",
//           description: "Please select an Excel file (.xlsx or .xls)",
//           variant: "destructive",
//         });
//       }
//     }
//   };

//   const handleImport = () => {
//     if (selectedFile) {
//       importMenuMutation.mutate(selectedFile);
//     }
//   };

//   const resetForm = () => {
//     setSelectedFile(null);
//     setImportResult(null);
//     onClose();
//   };

//   return (
//     <Dialog open={isOpen} onOpenChange={resetForm}>
//       <DialogContent className="max-w-2xl">
//         <DialogHeader>
//           <DialogTitle className="flex items-center gap-2">
//             <FileSpreadsheet className="h-5 w-5" />
//             Bulk Menu Import
//           </DialogTitle>
//         </DialogHeader>

//         <div className="space-y-6">
//           {/* Step 1: Download Template */}
//           <Card>
//             <CardHeader>
//               <CardTitle className="text-lg flex items-center gap-2">
//                 <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">1</span>
//                 Download Template
//               </CardTitle>
//             </CardHeader>
//             <CardContent>
//               <p className="text-gray-600 mb-4">
//                 Download the Excel template with the correct format for your restaurant's menu categories.
//               </p>
//               <Button
//                 onClick={() => downloadTemplateMutation.mutate()}
//                 disabled={downloadTemplateMutation.isPending}
//                 className="flex items-center gap-2"
//               >
//                 <Download className="h-4 w-4" />
//                 {downloadTemplateMutation.isPending ? "Downloading..." : "Download Excel Template"}
//               </Button>
//             </CardContent>
//           </Card>

//           {/* Step 2: Fill Template */}
//           <Card>
//             <CardHeader>
//               <CardTitle className="text-lg flex items-center gap-2">
//                 <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">2</span>
//                 Fill Template
//               </CardTitle>
//             </CardHeader>
//             <CardContent>
//               <Alert>
//                 <AlertCircle className="h-4 w-4" />
//                 <AlertDescription>
//                   <strong>Template Format:</strong>
//                   <ul className="mt-2 ml-4 list-disc space-y-1">
//                     <li><strong>Name:</strong> Menu item name (required)</li>
//                     <li><strong>Description:</strong> Item description (required)</li>
//                     <li><strong>Price:</strong> Price as number (required)</li>
//                     <li><strong>Category:</strong> Must match your restaurant's categories (required)</li>
//                     <li><strong>IsVeg:</strong> TRUE for vegetarian, FALSE for non-vegetarian (required)</li>
//                     <li><strong>Image:</strong> Image URL or filename (required)</li>
//                     <li><strong>IsAvailable:</strong> TRUE for available, FALSE for unavailable (optional, defaults to TRUE)</li>
//                   </ul>
//                 </AlertDescription>
//               </Alert>
//             </CardContent>
//           </Card>

//           {/* Step 3: Upload File */}
//           <Card>
//             <CardHeader>
//               <CardTitle className="text-lg flex items-center gap-2">
//                 <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold">3</span>
//                 Upload Filled Template
//               </CardTitle>
//             </CardHeader>
//             <CardContent className="space-y-4">
//               <div>
//                 <Label htmlFor="menu-file">Select Excel File</Label>
//                 <Input
//                   id="menu-file"
//                   type="file"
//                   accept=".xlsx,.xls"
//                   onChange={handleFileSelect}
//                   className="mt-1"
//                 />
//               </div>

//               {selectedFile && (
//                 <div className="bg-green-50 border border-green-200 rounded-lg p-3">
//                   <div className="flex items-center gap-2">
//                     <CheckCircle className="h-4 w-4 text-green-600" />
//                     <span className="text-green-800">
//                       File selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
//                     </span>
//                   </div>
//                 </div>
//               )}

//               <Button
//                 onClick={handleImport}
//                 disabled={!selectedFile || importMenuMutation.isPending}
//                 className="w-full flex items-center gap-2"
//               >
//                 <Upload className="h-4 w-4" />
//                 {importMenuMutation.isPending ? "Importing..." : "Import Menu Items"}
//               </Button>

//               {importMenuMutation.isPending && (
//                 <div className="space-y-2">
//                   <Progress value={50} className="w-full" />
//                   <p className="text-sm text-gray-600 text-center">Processing your menu items...</p>
//                 </div>
//               )}
//             </CardContent>
//           </Card>

//           {/* Import Results */}
//           {importResult && (
//             <Card>
//               <CardHeader>
//                 <CardTitle className={`text-lg flex items-center gap-2 ${
//                   importResult.success ? 'text-green-600' : 'text-orange-600'
//                 }`}>
//                   {importResult.success ? (
//                     <CheckCircle className="h-5 w-5" />
//                   ) : (
//                     <AlertCircle className="h-5 w-5" />
//                   )}
//                   Import Results
//                 </CardTitle>
//               </CardHeader>
//               <CardContent>
//                 <div className="space-y-3">
//                   <div className="grid grid-cols-2 gap-4 text-sm">
//                     <div className="bg-green-50 p-3 rounded-lg">
//                       <div className="text-green-800 font-medium">Successfully Imported</div>
//                       <div className="text-2xl font-bold text-green-600">{importResult.imported}</div>
//                     </div>
//                     <div className="bg-red-50 p-3 rounded-lg">
//                       <div className="text-red-800 font-medium">Failed</div>
//                       <div className="text-2xl font-bold text-red-600">{importResult.failed}</div>
//                     </div>
//                   </div>

//                   {importResult.errors && importResult.errors.length > 0 && (
//                     <Alert variant="destructive">
//                       <AlertCircle className="h-4 w-4" />
//                       <AlertDescription>
//                         <div className="font-medium mb-2">Errors encountered:</div>
//                         <ul className="ml-4 list-disc space-y-1">
//                           {importResult.errors.slice(0, 5).map((error, index) => (
//                             <li key={index} className="text-sm">{error}</li>
//                           ))}
//                           {importResult.errors.length > 5 && (
//                             <li className="text-sm font-medium">
//                               ... and {importResult.errors.length - 5} more errors
//                             </li>
//                           )}
//                         </ul>
//                       </AlertDescription>
//                     </Alert>
//                   )}
//                 </div>
//               </CardContent>
//             </Card>
//           )}
//         </div>

//         <div className="flex justify-end gap-2 pt-4 border-t">
//           <Button variant="outline" onClick={resetForm}>
//             {importResult ? "Close" : "Cancel"}
//           </Button>
//         </div>
//       </DialogContent>
//     </Dialog>
//   );
// }
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Download, Upload, FileSpreadsheet, AlertCircle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface BulkMenuImportProps {
  restaurantId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ImportResult {
  success: boolean;
  message: string;
  imported: number;
  inserted: number;
  updated: number;
  failed: number;
  errors?: string[];
}

export function BulkMenuImport({ restaurantId, isOpen, onClose, onSuccess }: BulkMenuImportProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const { toast } = useToast();

  const downloadTemplateMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("adminToken");
      const response = await fetch(`/api/admin/restaurants/${restaurantId}/menu-template`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to download template");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `menu-template-${restaurantId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
    onSuccess: () => {
      toast({
        title: "Template Downloaded",
        description: "Excel template has been downloaded successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Download Failed",
        description: error.message || "Failed to download template",
        variant: "destructive",
      });
    },
  });

  const importMenuMutation = useMutation({
    mutationFn: async (file: File) => {
      const token = localStorage.getItem("adminToken");
      const formData = new FormData();
      formData.append("menuFile", file);

      const response = await fetch(`/api/admin/restaurants/${restaurantId}/menu-import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Import failed: ${response.statusText}`);
      }

      return await response.json();
    },
    onSuccess: (result: ImportResult) => {
      setImportResult(result);
      if (result.success) {
        toast({
          title: "Import Successful",
          description: `${result.inserted ?? 0} added, ${result.updated ?? 0} updated — no duplicates created.`,
        });
        onSuccess();
      } else {
        toast({
          title: "Import Completed with Errors",
          description: `${result.inserted ?? 0} added, ${result.updated ?? 0} updated, ${result.failed} failed`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import menu items",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || 
          file.type === "application/vnd.ms-excel" ||
          file.name.endsWith('.xlsx') || 
          file.name.endsWith('.xls')) {
        setSelectedFile(file);
        setImportResult(null);
      } else {
        toast({
          title: "Invalid File Type",
          description: "Please select an Excel file (.xlsx or .xls)",
          variant: "destructive",
        });
      }
    }
  };

  const handleImport = () => {
    if (selectedFile) {
      importMenuMutation.mutate(selectedFile);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setImportResult(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={resetForm}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Bulk Menu Import
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 -mr-2">
          <div className="space-y-4 lg:space-y-6">
            {/* Step 1: Download Template */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base lg:text-lg flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0">1</span>
                  Download Template
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-gray-600 mb-3 text-sm lg:text-base">
                  Download the Excel template with the correct format for your restaurant's menu categories.
                </p>
                <Button
                  onClick={() => downloadTemplateMutation.mutate()}
                  disabled={downloadTemplateMutation.isPending}
                  className="flex items-center gap-2 w-full sm:w-auto"
                  size="sm"
                >
                  <Download className="h-4 w-4" />
                  {downloadTemplateMutation.isPending ? "Downloading..." : "Download Excel Template"}
                </Button>
              </CardContent>
            </Card>

            {/* Step 2: Fill Template */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base lg:text-lg flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0">2</span>
                  Fill Template
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Alert>
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <strong className="block">Template Format:</strong>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs lg:text-sm">
                        <div className="space-y-1">
                          <div><strong>Name:</strong> Menu item name (required)</div>
                          <div><strong>Description:</strong> Item description (required)</div>
                          <div><strong>Price:</strong> Price as string (required)</div>
                          <div><strong>Category:</strong> Must match restaurant categories (required)</div>
                        </div>
                        <div className="space-y-1">
                          <div><strong>IsVeg:</strong> TRUE/FALSE for vegetarian (required)</div>
                          <div><strong>Image:</strong> Image URL or filename (required)</div>
                          <div><strong>IsAvailable:</strong> TRUE/FALSE (optional, defaults to TRUE)</div>
                        </div>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* Step 3: Upload File */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base lg:text-lg flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0">3</span>
                  Upload Filled Template
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <div>
                  <Label htmlFor="menu-file" className="text-sm lg:text-base">Select Excel File</Label>
                  <Input
                    id="menu-file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileSelect}
                    className="mt-1"
                  />
                </div>

                {selectedFile && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <span className="text-green-800 text-sm lg:text-base break-all">
                        File selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleImport}
                  disabled={!selectedFile || importMenuMutation.isPending}
                  className="w-full flex items-center gap-2"
                  size="sm"
                >
                  <Upload className="h-4 w-4" />
                  {importMenuMutation.isPending ? "Importing..." : "Import Menu Items"}
                </Button>

                {importMenuMutation.isPending && (
                  <div className="space-y-2">
                    <Progress value={50} className="w-full" />
                    <p className="text-xs lg:text-sm text-gray-600 text-center">Processing your menu items...</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Import Results */}
            {importResult && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className={`text-base lg:text-lg flex items-center gap-2 ${
                    importResult.success ? 'text-green-600' : 'text-orange-600'
                  }`}>
                    {importResult.success ? (
                      <CheckCircle className="h-5 w-5 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    )}
                    Import Results
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div className="bg-green-50 p-3 rounded-lg">
                        <div className="text-green-800 font-medium text-xs lg:text-sm">Newly Added</div>
                        <div className="text-xl lg:text-2xl font-bold text-green-600">{importResult.inserted ?? 0}</div>
                      </div>
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <div className="text-blue-800 font-medium text-xs lg:text-sm">Updated</div>
                        <div className="text-xl lg:text-2xl font-bold text-blue-600">{importResult.updated ?? 0}</div>
                      </div>
                      <div className="bg-red-50 p-3 rounded-lg">
                        <div className="text-red-800 font-medium text-xs lg:text-sm">Failed</div>
                        <div className="text-xl lg:text-2xl font-bold text-red-600">{importResult.failed}</div>
                      </div>
                    </div>

                    {importResult.errors && importResult.errors.length > 0 && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        <AlertDescription>
                          <div className="font-medium mb-2 text-sm">Errors encountered:</div>
                          <div className="max-h-32 overflow-y-auto">
                            <ul className="ml-4 list-disc space-y-1">
                              {importResult.errors.slice(0, 10).map((error, index) => (
                                <li key={index} className="text-xs lg:text-sm break-words">{error}</li>
                              ))}
                              {importResult.errors.length > 10 && (
                                <li className="text-xs lg:text-sm font-medium">
                                  ... and {importResult.errors.length - 10} more errors
                                </li>
                              )}
                            </ul>
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={resetForm} size="sm">
            {importResult ? "Close" : "Cancel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}