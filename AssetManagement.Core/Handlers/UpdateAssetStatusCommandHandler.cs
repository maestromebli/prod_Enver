using AssetManagement.Core.Interfaces;
using AssetManagement.Core.Models;
using AssetManagement.Core.Commands;
using MediatR;

namespace AssetManagement.Core.Handlers;

public class UpdateAssetStatusCommandHandler : IRequestHandler<UpdateAssetStatusCommand, AssetSummary>
{
    private readonly IAssetRepository _repository;

    public UpdateAssetStatusCommandHandler(IAssetRepository repository) => _repository = repository;

    public Task<AssetSummary> Handle(UpdateAssetStatusCommand request, CancellationToken cancellationToken) =>
        _repository.UpdateAssetStatusAsync(request.Request, cancellationToken);
}
